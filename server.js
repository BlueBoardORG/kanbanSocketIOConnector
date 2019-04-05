
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

MongoClient.connect(process.env.MONGODB_URL).then(client => {
    const db = client.db(process.env.MONGODB_NAME);
    
    app.get("/isalive", (req,res,next)=>{
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

    io.on("connection", socket=>{
        socket.emit("connected");

        socket.on("userDetails", ({user})=>{
            const {_id: userID } = user;
            if(!(userID in userSockets))
                userSockets[userID] = [];
            const doesSocketExists = userSockets[userID].filter(sock => sock.id === socket.id).length;
            if (doesSocketExists === 0)
                userSockets[userID].push(socket);
        })

        socket.on("disconnect", ()=>{
            let keys = Object.keys(userSockets);
            for(let i=0; i< keys.length; i++){
                const original_length = userSockets[keys[i]].length;
                userSockets[keys[i]] = userSockets[keys[i]].filter(sock => sock.id !== socket.id);
                if(original_length !== userSockets[keys[i]].length)
                    break;
            }
        })
    })

    const history = db.collection("history");
    const boards = db.collection("boards");
    let historyCursor = history.watch();
    historyCursor.on("change", ({fullDocument})=>{
        if(fullDocument){
            let {userId, action, payload,boardId, socketId} = fullDocument;
            sendChangeAndHistoryMessage(userId, action, payload, boardId,boards,socketId);
        }
    })

    const notifications = db.collection("notifications");
    let notifCursor = notifications.watch();
    notifCursor.on("change", ({fullDocument})=>{
        if(fullDocument){
            let {userId} = fullDocument;
            if(userId){
                sendNotification(userId,fullDocument)
            }
        }
    })
});

function sendHistoryMessage(users,action,boardId,userId){
    users.forEach(user=>{
        if(userSockets[user] && userSockets[user].length > 0){
            userSockets[user].forEach(sock=> {
                sock.emit("historyItem", {action,boardId,userId});
            })
        }
    })
}

function sendChangeAndHistoryMessage(userId, action,payload,boardId,boards,socketId){
    boards.findOne({_id: boardId}).then(board=>{
        if(board){
            let {users} = board;
            let userSet = new Set(users.map(user => user.id));
            users = [...userSet];
            sendHistoryMessage(users,action,boardId,userId);
            users.forEach(user=>{
                if(userSockets[user] && userSockets[user].length > 0){
                    userSockets[user].forEach(sock => {
                        if(sock.id !== socketId)
                            sock.emit("change", {action,payload});
                    })
                }
            })
        }
    }).catch(err=> console.error(err));
}

function sendNotification(user,notification){
    if(userSockets[user] && userSockets[user].length > 0){
        userSockets[user].forEach(sock =>{
            sock.emit("notification",notification);
        })
    }
}

