// ENV ---------------------------------------------------------------------
// sudo sysctl fs.inotify.max_user_watches=582222 && sudo sysctl -p

const { DateTime } = require('luxon');
const dotenv = require('dotenv');
dotenv.config();
const PORT = process.env.PORT;
const NAME = process.env.NAME;
const UPFOLDER = process.env.UPFOLDER;
const APP = process.env.APP;

// PARES -------------------------------------------------------------------
var sessions = new Map();
function session_set(peerid, data) {
    if (peerid != null && sessions.has(peerid))
        sessions.set(
            peerid,
            {
                ...sessions.get(peerid),
                ...data
            },
        );
    else {
        log('ERROR session_set ' + peerid + ' ' + JSON.stringify(data));
    }
}

function session_new(socket) {
    let peerid = socket.handshake.query.peerid;
    if (peerid != null) {
        sessions.set(peerid, {
            // Estos parámetros se cargan en la conexión desde el móvil
            'peerid': peerid,
            'alias': socket.handshake.query.alias,
            'description': socket.handshake.query.description,
            'platform': socket.handshake.query.platform,
            'position': socket.handshake.query.position,
            'oncall': false,
        });
    }
}

function session_end(peerid) {
    if (peerid != null && sessions.has(peerid))
        sessions.delete(peerid);
    else {
        log('ERROR session_set ' + peerid);
    }
}

// HTTP ---------------------------------------------------------------------
const http = require('http');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const upload = multer({ dest: 'uploads/' });
const app = express();
app.use('/' + UPFOLDER, express.static(UPFOLDER));
app.get('/', (req, res) => res.redirect('/status'));
app.get('/status', get_status);
app.get('/cancel', get_cancel);
app.get('/files', get_files);
app.post('/upload', upload.single("file"), post_upload);
app.get('/download', get_download);
const server = http.Server(app);
server.listen(PORT, '0.0.0.0', () => {
    log(`http ${NAME} running on ${PORT}`);
});


function get_status(req, res) {
    log('GET /status ' + getIP(req));
    var debug = req.query.debug;

    let string = '<html><style>* { font: 18px "Lucida Console", monospace; }</style><body>';
    string += `${NAME}: ${sessions.size} pares<br/><ul>`;
    try {
        sessions.forEach(item => {
            let peerid = item.peerid;
            string += '<li>'
                + peerid.substring(0, 8) + ': '
                + item.alias + ', '
                + item.description + ' '
                + (item.oncall ? '(' + item.remote + ') [<a href="./cancel?id=' + peerid + '">x</a>]' : '')
                + '</li>'
            if (debug == 1) string += JSON.stringify(item) + '<br/>'
            //string += '<br/>'
        });
    } catch (error) {
        string += 'ERROR<br/>';
    }
    string += '</ul>' + getTime() + '<br/>';
    string += '<a href="./">Home</a> | ' +
        '<a href="./status?debug=1">Debug</a> | ' +
        '<a href="./files">Files</a> | ' +
        '<a href="./download">Download</a>';
    string += '</html></body>';
    res.end(string);
}

function get_files(req, res) {
    log('GET /files ' + getIP(req));

    let string = '<html><style>* { font: 18px "Lucida Console", monospace; }</style><body>';
    string += `${NAME}: ${sessions.size} pares<br/><ul>`;

    let files = filenames = fs.readdirSync(UPFOLDER);

    files.forEach(function (file) {
        string += '<li><a href="' + UPFOLDER + '/' + file + '" target="_blank">' + file + '</a></li>'
    });

    string += '</ul>' + getTime() + '<br/>';
    string += '<a href="./">Home</a> | ' +
        '<a href="./status?debug=1">Debug</a> | ' +
        '<a href="./files">Files</a> | ' +
        '<a href="./download">Download</a>';
    string += '</html></body>';
    res.end(string);
}
function get_cancel(req, res) {
    log('GET /cancel ' + getIP(req));
    var peerid = req.query.id;
    io.to(peerid).emit('on-hangup');
    session_set(peerid, { oncall: false });
    res.redirect('/');
}
function post_upload(req, res) {
    log('POST /upload ' + getIP(req));

    var src = fs.createReadStream(req.file.path);
    var dest = fs.createWriteStream(UPFOLDER + '/' + req.file.originalname);
    src.pipe(dest);
    src.on('end', function () {
        fs.unlinkSync(req.file.path);
        res.json('OK: recibido ' + req.file.originalname);
    });
    src.on('error', function (err) { res.json('Oh Oh!'); });
}
function get_download(req, res) {
    log('GET /download ' + getIP(req));

    //const file = `${__dirname}/app/app-release.apk`; <-- src
    const file = "app/" + APP;
    res.download(file);
}

// WS ----------------------------------------------------------------------
const socketio = require('socket.io');
const { set } = require('express/lib/application');
var io = socketio(server);
log(`ws ${NAME} running on ${PORT}`);


io.on('connection', socket => {
    // RECIBIMOS UNA NUEVA CONEXION
    // socket.handshake.query.username = peerid; //<- podemos añadir datos al socket
    let peerid = socket.handshake.query.peerid;
    let alias = socket.handshake.query.alias;
    socket.join(peerid); // room == peerid -> para emit
    session_new(socket);
    logs(socket, 'connection ' + alias);

    // ============= Mensajes individuales ============================
    // READY: Prueba. No se usa
    socket.on('ready', data => {
        let peerid = socket.handshake.query.peerid;
        logs(socket, 'ready');
    });

    // sessions: Pide una lista de sessions. (Al abrir el listín telefónico)
    socket.on('peers', (data) => {
        let peerid = socket.handshake.query.peerid;
        let alias = socket.handshake.query.alias;

        logs(socket, `peers ${alias} ${sessions.size}`);

        var list = [];
        Array.from(sessions, ([key, value]) => {
            if (key != null) list.push(value);
            else (session_end(key));
        });
        // for (let i = 1; i < 8; i++) {
        //     list.push({ peerid: 'FakePeer' + i, alias: 'ejemFake' + i, platform: 'none', oncall: true });
        // }
        socket.emit('on-peers', list);
    });

    // ALIAS: Cambio de identificación
    socket.on('alias', ({ alias, description }) => {
        let peerid = socket.handshake.query.peerid;
        logs(socket, 'alias ' + alias + ', ' + description);
        session_set(peerid, {
            alias: alias,
            description: description
        })
    });

    // DISCONNET: Se ha desconectado un peer. Apagado, Cerrar App, Error, etc..
    // No es necesario enviarlo desde el cliente
    socket.on('disconnect', () => {
        let peerid = socket.handshake.query.peerid;
        let alias = socket.handshake.query.alias;

        let peer = sessions.get(peerid);
        try {
            if (peer.oncall) {
                io.to(peer.remote).emit('on-hangup');
                session_set(peer.remote, { oncall: false, remote: null });
                logtp(socket, 'on-hangup', peer.remote);
            }
        } catch { }
        session_end(peerid);
        logs(socket, 'disconnet ' + alias);
    });

    // ============= Mensajes entre pares ==== msg -> on-msg ====
    // CALL: Inicio de llamada y envio de oferta SDP
    socket.on('call', ({ topeerid, offer }) => {
        const peerid = socket.handshake.query.peerid; //llamador

        // Control de error si no existe la peer remoto, cancelo la llamada
        if (!sessions.has(topeerid)) {
            io.to(peerid).emit('on-hangup');
            return;
        }
        // Se ha dado el caso de desaparecer del peers el propio llamador!!!
        if (!sessions.has(peerid)) {
            session_new(socket);
        }
        logtp(socket, 'call', topeerid);

        let llamador = sessions.get(peerid);
        io.to(topeerid).emit('on-call', {
            peerid: topeerid, //llamado
            remotepeer: llamador, // el llamador es el remote peer cuando llega al llamado
            offer
        });
    });

    // ANSWER: Respondemos a la llamada y envio de answer
    socket.on('answer', ({ peerid, answer }) => {
        logtp(socket, 'answer', peerid);
        io.to(peerid).emit('on-answer', answer);
    });

    // CANDIDATE: Aceptación de llamada por ambas partes (se envia varias veces)
    socket.on('candidate', ({ peerid, candidate }) => {
        logtp(socket, 'candidate', peerid);
        io.to(peerid).emit('on-candidate', candidate);

        const from = socket.handshake.query.peerid;
        session_set(peerid, { oncall: true, remote: from });
    });

    // HANGUP: Fin y cierre de la llamada
    socket.on('hangup', (peerid) => {
        logtp(socket, 'hangup', peerid);
        // El emisor del mensaje de cancelación (depende de cómo decidamos hacerlo en el movil)
        const emisor = socket.handshake.query.peerid; // llamador
        session_set(emisor, { oncall: false, remote: null });
        // El destinatario de la cancelación
        io.to(peerid).emit('on-hangup');
        session_set(peerid, { oncall: false, remote: null });
    });

    // MIRROR: Cambio del stream de cámara y necesita mirror ?¿?¿?¿
    socket.on('mirror', (peerid) => {
        logs(socket, 'mirror');
        io.to(peerid).emit('on-mirror');
    });

});

// LOG -------------------------------------------------------------------------------

function logtp(socket, msg, peerid) {
    let falias = socket.handshake.query.alias;
    let to = sessions.get(peerid);
    let talias = 'ERROR';
    try {
        talias = to.alias;
    } catch { }

    let nmsg = `${msg} ${falias} -> ${talias} ${peerid.substring(0, 8)}`
    logs(socket, nmsg);
}

function logs(socket, msg) {
    try {
        let peerid = socket.handshake.query.peerid;
        //let data = socket.handshake.query.alias + ' ' + msg;
        let nmsg = `${peerid.substring(0, 8)} | ${msg}`
        log(nmsg);
    }
    catch {
        console.log(socket.handshake.query)
        log(`ERROR NO PEERID | ${msg}`);
    }
}

function log(msg) {
    console.log(getTime() + ` | ${msg}`);
}

function getIP(req) {
    return req.headers['x-real-ip'] || req.connection.remoteAddress;
}

function getTime() {
    //const{ DateTime } = require('luxon');
    let m = DateTime.local();
    return m.toISODate() + " " + m.toLocaleString(DateTime.TIME_24_WITH_SECONDS);
}