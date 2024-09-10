const express = require('express');
const { spawn } = require('child_process');
const WebSocket = require('ws'); // Import WebSocket library
const cors = require('cors');

var app = express();
var http = require('http').Server(app);
const wss = new WebSocket.Server({ server: http });  // Create WebSocket server

app.use(express.static('public'));
app.use(cors());

const fs = require('fs'); // Import file system module
const path = require('path'); // Import path module for handling file paths
const unzip = require('unzip-stream'); // Import unzip library
const Busboy = require('busboy') // Import busboy library for parsing multipart form data

const CONTIKI_DIR = '/home/iot/Desktop/contiki-ng';
const DEPLOY_DIR = `${CONTIKI_DIR}/auto-deploy`;

app.post('/upload-code', function (req, res) {
  const bb = new Busboy({ headers: req.headers });

  let filePath = null;
  let tempDir = null;

  bb.on('file', (fieldname, file, filename, encoding, mimetype) => {
    // If there is no 'temp' directory, create one
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'));
    }
    tempDir = path.join(__dirname, 'temp');
    filePath = path.join(tempDir, filename);
    file.pipe(fs.createWriteStream(filePath));
  });

  bb.on('field', (fieldname, value) => {

  });

  bb.on('finish', () => {
    // Check if the "auto-deploy" directory exists, create it if not
    if (!fs.existsSync(DEPLOY_DIR)) {
      fs.mkdirSync(DEPLOY_DIR);
    }


    // Unzip the uploaded file
    fs.createReadStream(filePath)
      .pipe(unzip.Extract({ path: DEPLOY_DIR })) // Extract to target path
      .on('finish', () => {
        // Delete temporary directory and uploaded file
        fs.rmSync(tempDir, { recursive: true });
        res.send('Code uploaded and extracted successfully!');

        // Optional: Automatic scrolling (client-side implementation recommended)
        // You can uncomment and modify this section to send a message for scrolling on the frontend
        // res.write(`<script>window.scrollTo(0, document.body.scrollHeight);</script>`);
        // res.end();
      })
      .on('error', (error) => {
        console.error(error);
        fs.rmSync(tempDir, { recursive: true }); // Cleanup on error
        res.status(500).send('Error unzipping code!');
      });
  });

  bb.on('error', (error) => {
    console.error(error);
    res.status(500).send('Error parsing request');
  });

  req.pipe(bb); // Pass the request body to busboy
});


wss.on('connection', function (ws) {
  console.log('Client connected');

  let logProcess = null;

  ws.on('message', message => {
    console.log(`Client message: ${message}`);
    // The message is either 'start-log {deviceId}' or 'stop-log'
    if (message.includes('start-log')){
      message = message.toString();
      deviceId = message.split(' ')[1];
      console.log('Starting log process')

      // Start the log process on 'start-log' message
      logProcess = spawn('rlwrap', [
        `${CONTIKI_DIR}/tools/serial-io/serialdump`,
        '-b115200',
        `/dev/ttyACM${deviceId - 1}`
      ]);

      logProcess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
        // Send log data to all connected clients
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data);
          }
        });
      });

      logProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });

      logProcess.on('close', (code) => {
        if (code === 0) {
          ws.send('Log stream closed successfully!');
        } else {
          ws.send('Issue connecting to the device!');
        }
      });
    } else if (message == 'stop-log') {
      // Stop the log process on 'stop-log' message
      if (logProcess) {
        logProcess.kill();
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    // Stop the log process on client disconnect (optional)
    if (logProcess) {
      logProcess.kill();
    }
  });
});

app.get('/deploy-code', function (req, res) {
  // Get folder name from the body of the request
  const folderName = req.query.folderName;
  const dfuUploadName = req.query.dfuUploadName;
  const deviceId = req.query.deviceId;

  const deployProcess = spawn('make', [
    '-C', `${DEPLOY_DIR}/${folderName}`,
    'TARGET=nrf52840',
    'BOARD=dongle',
    `${dfuUploadName}.dfu-upload`,
    `PORT=/dev/ttyACM${deviceId - 1}`
  ]);

  deployProcess.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  deployProcess.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  deployProcess.on('close', (code) => {
    if (code === 0) {
      res.send('Code upload successful!');
    } else {
      res.status(500).send('Error uploading code!');
    }
  });
});

app.get('/dongles', function (req, res) {
  res.send(getDongles());
});


function getDongles() {
  // #TODO

  // run the command dmesg | grep ttyACM -B 4
  // to get the list of dongles connected to the system
  const execSync = require('child_process').execSync;
  const output = execSync('bash scdev.sh').toString();

  const dongleinfo = output.split('\n');
  var deviceList = []
  // the last element is always empty
  dongleinfo.pop();
  for (const dongle of dongleinfo){
    var details = dongle.split(',');  

    deviceList.push({
      id: details[0],
      port: details[1]
    });
  }

  return deviceList;
}


app.get('/', function (req, res) {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/devices', function (req, res) {
  res.sendFile(__dirname + '/public/devices.html');
});

http.listen(3000, function () {
  console.log('listening on *:3000');
});
