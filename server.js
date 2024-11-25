require('dotenv').config();
const express = require('express')  // Importing express framework
const app = express()   // Creating instance/application object of Express application
const server = require('http').Server(app)  // importing http a built-in module like fs(file-system) module for handling http requests and responses
const io = require('socket.io')(server);  //importing socket.io library for real-time(without loading) bidirectional communication between server and client
const { v4: uuidV4 } = require('uuid') // uuid is to generate unique random ids which we will use as unique room IDs
const nodemailer = require('nodemailer');
const fs = require('fs');
const passport = require('passport');
const session = require('express-session');
const GoogleStrategy = require('passport-google-oauth2').Strategy;


passport.serializeUser((user, done) => {
    done(null, user);
})
passport.deserializeUser(function (user, done) {
    done(null, user);
});
let name
passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: "http://localhost:5000/google/callback",
    passReqToCallback: true
},
    function (request, accessToken, refreshToken, profile, done) {
        name = profile.displayName;
        return done(null, profile);
    }
));


// Setting up peerjs by importing express app for it and importing http module for peer and setting up options and port
var ExpressPeerServer = require('peer').ExpressPeerServer;
var peerExpress = require('express');
var peerApp = peerExpress();
var peerServer = require('http').createServer(peerApp);
var options = { debug: true, allow_discovery: true };

// Session configuration
app.use(session({
    secret: process.env.CLIENT_SECRET,
    resave: false,
    saveUninitialized: false
}));


// Sets the view engine to ejs template express javascript template
app.set('view engine', 'ejs')
app.use(express.static('public'))
app.use(passport.initialize());
app.use(passport.session());

peerApp.use('/peerjs', ExpressPeerServer(peerServer, options));

app.get('/start', (req, res) => {
    res.render('start');
});

app.get('/join', (req, res) => {
    res.render('join');
});

app.get('/', (req, res) => {
    res.render('home');
});

// Auth
app.get('/google', (req, res, next) => {
    console.log('Redirecting to Google OAuth with URL:', req.url);
    next();
}, passport.authenticate('google', {
    scope: ['email', 'profile']
}));

// Auth Callback

app.get('/google/callback', passport.authenticate('google', {
    successRedirect: '/google/callback/success',
    failureRedirect: '/google/callback/failure'
}));

// Success
app.get('/google/callback/success', (req, res) => {
    if (!req.user)
        return res.redirect('/google/callback/failure');
    res.render('start');
});

// Failure
app.get('/google/callback/failure', (req, res) => {
    res.send("Error");
});

app.get('/meeting', (req, res) => {
    res.redirect(`/${uuidV4()}`)
})

app.get('/leavewindow', (req, res) => {
    res.render('leavewindow');
})

app.get('/:room', (req, res) => {
    res.render('room', { roomId: req.params.room })
})

class AttendanceRecord{
    constructor(name,id,time,leavingTime){
        this.name = name
        this.id = id
        this.time = time
        this.leavingTime = leavingTime
    }
}

let participant = [];
let participantname = new Map();
let attendancerecord = new Map();
io.on('connection', socket => {
    socket.on('join-room', (roomId, userId) => {
        participant.push(socket.id);
        participantname.set(socket.id, name);
        socket.join(roomId);
        socket.broadcast.to(roomId).emit('connected-user', userId);
        socket.on('mark-attendance', () => {
            const attendance = new AttendanceRecord(
                participantname.get(socket.id), 
                userId,
                new Date(),
                null
            );
            if (!attendancerecord.has(roomId)) {
                attendancerecord.set(roomId, []);
                console.log("pushed")
            }
            attendancerecord.get(roomId).push(attendance);
            console.log("pushed in the array")
            console.log(roomId)
        });
        socket.on('disconnect', () => {
            let user = socket.id;
            let participantName = participantname.get(user);
            if (attendancerecord.has(roomId)) {
                const records = attendancerecord.get(roomId);
                const record = records.find(r => r.id === userId);
                if (record) {
                    record.leavingTime = new Date(); // Update the leaving time
                    console.log(`Leaving time updated for user ${record.name}`);
                }
            }
            let leavingParticipant = participant.indexOf(user) + participant.length + 1;
            console.log(leavingParticipant);
            let participantNameObj = Object.fromEntries(participantname);
            socket.broadcast.to(roomId).emit('disconnected-user', socket.id, participantNameObj, leavingParticipant);
            name = participantname.get(user);
            participant.splice(participant.indexOf(user), 1);
            participantname.delete(user);
        });
        socket.on('get-attendance', (roomId) => {
           try{
            console.log("event triggered")
            if (!attendancerecord.has(roomId)) {
                console.log("here in if")
                socket.emit('recieve-attendance', 'No attendance records found for this room.');
                return;
            }     
            const records = attendancerecord.get(roomId);
            // Prepare file content
            let fileContent = `Attendance Record for Room ID: ${roomId}\n\n`;
            fileContent += 'Name\t                  User ID\t                  Joining Time\t                                              Leaving Time\n';
            fileContent += '---------------------------------------------------------\n';
        
            records.forEach(record => {
                fileContent += `>> ${record.name || 'Unknown'}     \t>> ${record.id}\t>> ${record.time}\t>> ${record.leavingTime || 'N/A'}\n`;
            });
        
            // Send the file content to the specific client as Base64
            socket.emit('download-attendance', {
                filename: `attendance_${roomId}.txt`, // Dynamic filename
                content: Buffer.from(fileContent).toString('base64'), // Base64 encode the content
            });
            console.log("file sent")
           }catch(error){
            console.log(error)
           }
        });
        socket.on('send', (chat, ID) => {
            io.to(roomId).emit('userMessage', chat, participantname.get(ID));
        })
        socket.on('view-participants', () => {
            let participantNameObj = Object.fromEntries(participantname);
            socket.emit('participants', participant, participantNameObj);
        });

        socket.on('start-whiteboard', () => {
            socket.broadcast.to(roomId).emit('start-whiteboard');
        })

        socket.on('draw', (x, y, color) => {
            io.to(roomId).emit('ondraw', x, y, color);
        })

        socket.on('erase', () => {
            io.to(roomId).emit('onerase');
        })
        socket.on('file-uploaded', (fileUrl) => {
            console.log('File uploaded:', fileUrl);
            // Broadcast the file URL to other users in the room
            io.emit('file-shared', fileUrl);
        });
        socket.on('sendInvite', emailId => {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.USER,
                    pass: process.env.PASS
                }
            });

            const mailOptions = {
                from: process.env.USER, // sender address
                to: emailId, // list of receivers
                subject: "Meet Invitation", // Subject line
                text: `You have been invited to join the meet. You can join the meet through this link : https://convoconnect.onrender.com/${roomId}`, // plain text body
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.log(error);
                }
                else {
                    console.log('Email sent');
                    socket.emit('emailSent', info.response);
                }
            })
        });

        

        socket.on('disconnect', () => {
            let user = socket.id;
            let leavingParticipant=participant.indexOf(user)+participant.length+1;
            console.log(leavingParticipant);
            let participantNameObj = Object.fromEntries(participantname);
            socket.broadcast.to(roomId).emit('disconnected-user', socket.id, participantNameObj,leavingParticipant);
            name = participantname.get(user);
            participant.splice(participant.indexOf(user), 1);
            participantname.delete(user);
        })

    });
})

server.listen(5000 || process.env.PORT , () => {
    console.log('Server is running on port 5000')
})
peerServer.listen(9000);