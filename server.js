
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

        socket.on("userDetails", ({_id: userID})=>{
            userSockets[userID] = socket;
        })

        socket.on("disconnect", ()=>{
            let keys = Object.keys(userSockets);
            for(let i=0; i< keys.length; i++){
                if(userSockets[keys[i]].id === socket.id){
                    delete userSockets[keys[i]];
                    break;
                }
            }
        })
    })

    const boards = db.collection("boards");
    let boardCursor = boards.watch();
    boardCursor.on("change", ({fullDocument})=>{
        let {users, changed_by} = fullDocument;
        sendChangeMessage(users, changed_by);
    })

    const notifications = db.collection("notifications");
    let notifCursor = notifications.watch();
    notifCursor.on("change", ({fullDocument})=>{
        let {userId} = fullDocument;
        sendNotification(userId)
    })
});


function sendChangeMessage(users, changed_by){
    let userSet = new Set(users.map(user => user.id));
    users = [...userSet];
    users = users.filter(user => user!== changed_by);
    users.forEach(user=>{
        if(userSockets[user]){
            userSockets[user].emit("change");
        }
    })
}

function sendNotification(user){
    if(userSockets[user]){
        userSockets[user].emit("notification");
    }
}

