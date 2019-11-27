
const express = require("express");
const { MongoClient } = require("mongodb");
const compression = require("compression");
const helmet = require("helmet");
const logger = require("morgan");
const socketIO = require("socket.io");
const http = require("http");
const dotenv = require("dotenv");
let userSockets = {};

dotenv.config();

const app = express();

let db, notifications, users, boards, history;

MongoClient.connect(process.env.MONGODB_URL).then(client => {
    db = client.db(process.env.MONGODB_NAME);
    history = db.collection("history");
    boards = db.collection("boards");
    notifications = db.collection("notifications");
    users = db.collection("users");

    app.get("/isalive", (req, res, next) => {
        res.send("alive");
    })
    app.use(helmet());
    app.use(logger("tiny"));
    app.use(compression());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    let port = process.env.PORT || "8200";
    /* eslint-disable no-console */
    const server = http.createServer(app);
    server.listen(port, () => console.log(`Server listening on port ${port}`));

    const io = socketIO(server);

    io.on("connection", socket => {
        socket.emit("connected");

        socket.on("userDetails", ({ user }) => {
            const { _id: userID } = user;
            if (!(userID in userSockets))
                userSockets[userID] = [];
            const doesSocketExists = userSockets[userID].filter(sock => sock.id === socket.id).length;
            if (doesSocketExists === 0)
                userSockets[userID].push(socket);
        })

        socket.on("disconnect", () => {
            let keys = Object.keys(userSockets);
            for (let i = 0; i < keys.length; i++) {
                const original_length = userSockets[keys[i]].length;
                userSockets[keys[i]] = userSockets[keys[i]].filter(sock => sock.id !== socket.id);
                if (original_length !== userSockets[keys[i]].length)
                    break;
            }
        })
    })

    let historyCursor = history.watch();
    historyCursor.on("change", ({ fullDocument }) => {
        if (fullDocument) {
            let { userId, action, payload, boardId, socketId, date } = fullDocument;
            sendChangeAndHistoryMessage(userId, action, payload, boardId, socketId, date);
            createNotifications(userId, action, boardId);
        }
    })

    let notifCursor = notifications.watch();
    notifCursor.on("change", ({ fullDocument }) => {
        if (fullDocument) {
            let { notifTo } = fullDocument;
            if (notifTo) {
                sendNotification(notifTo, fullDocument)
            }
        }
    })
});

function sendHistoryMessage(users, action, boardId, userId, date) {
    users.forEach(user => {
        if (userSockets[user] && userSockets[user].length > 0) {
            userSockets[user].forEach(sock => {
                sock.emit("historyItem", { action, boardId, userId, date });
            })
        }
    })
}

function sendChangeAndHistoryMessage(userId, action, payload, boardId, socketId, date) {
    boardId ? boards.findOne({ _id: boardId }).then(board => {
        if (board) {
            let { users } = board;
            let userSet = new Set(users.map(user => user.id));
            users = [...userSet];
            sendHistoryMessage(users, action, boardId, userId, date);
            users.forEach(user => {
                if (userSockets[user] && userSockets[user].length > 0) {
                    userSockets[user].forEach(sock => {
                        if (sock.id !== socketId)
                            sock.emit("change", { action, payload });
                    })
                }
            })
        }
    }).catch(err => console.error(err)): null; 
}

function sendNotification(user, notification) {
    if (userSockets[user] && userSockets[user].length > 0) {
        userSockets[user].forEach(sock => {
            sock.emit("notification", notification);
        })
    }
}

async function createNotifications(userId, action, boardId) {
    const board = await boards.findOne({ _id: boardId });
    let { name } = await users.findOne({ _id: userId });
    const { firstName, lastName } = name;
    if (firstName || lastName) {
        name = `${firstName} ${lastName}`;
    }
    const { users: boardUsers, title } = board;
    boardUsers.forEach(user => {
        shouldSendNotification(user.id, action, user.watch, userId) ? createNotification({ action, boardId, title, from: name, wasSeen: false, notifTo: user.id }) : null;
    })
}

async function createNotification(notification) {
    await notifications.insertOne(notification);
}

function shouldSendNotification(userId, action, watchMode, skipUserId) {

    if (watchMode === "Ignoring" || userId === skipUserId)
        return false;

    const notWatchingFunctions = [
        "UPDATE_ASSIGNED_USER",
        "ADD_USER",
        "REMOVE_USER",
        "CHANGE_USER_ROLE"
    ];

    const watchingFunctions = [
        "TOGGLE_SOCKET_CONNECTION",
        "ENTER_AS_GUEST",
        "UPDATE_FILTER",
        "CHANGE_CARD_FILTER",
        "SET_CURRENT_CARD",
        "PUT_BOARD_ID_IN_REDUX",
        "ADD_BOARD",
        "LOAD_BOARD_USERS_DATA",
        "CHANGE_USER_WATCH"
    ];

    if (watchMode === "Watching" && !watchingFunctions.includes(action)) {
        return true;
    }

    if (watchMode === "Not watching" && notWatchingFunctions.includes(action)) {
        return true;
    }

    return false;
}

