const express = require('express');
const { spawn } = require('child_process');
const WebSocket = require('ws'); // Import WebSocket library
const cors = require('cors');
const axios = require('axios');
const schedule = require('node-schedule');
const FormData = require('form-data');
const crypto = require('crypto');
let fetch;

// Use dynamic import for node-fetch
import('node-fetch').then(nodeFetch => {
  fetch = nodeFetch;
}).catch(error => console.error(`Error importing node-fetch: ${error}`));

let free_at = {}
let scheduled_jobs = {}
let finished_jobs = {}
require('dotenv').config();

var app = express();
var http = require('http').Server(app);
const wss = new WebSocket.Server({ server: http });  // Create WebSocket server

app.use(express.static('public'));
app.use(express.json());
app.use(cors());

const fs = require('fs'); // Import file system module
const path = require('path'); // Import path module for handling file paths
const unzip = require('unzip-stream'); // Import unzip library
const Busboy = require('busboy'); // Import busboy library for parsing multipart form data
const { constants } = require('perf_hooks');

const CONTIKI_DIR = '/home/iot/Desktop/contiki-ng';
const DEPLOY_DIR = `${CONTIKI_DIR}/auto-deploy`;
const SERVER_PORT = process.env.SERVER_PORT;
const CLIENT_PORT = process.env.CLIENT_PORT;

let deviceSenders = {};

function generateUniqueJobId(params) {
  // Combine unique parameters into a string
  const data = params.join(',');

  // Generate hash using SHA-256
  const hash = crypto.createHash('sha256').update(data).digest('hex');

  // Convert hash to a numeric value and truncate to 6 digits
  const numericValue = parseInt(hash.substring(0, 12), 16); // 12 hex characters for 6 digits
  const jobId = numericValue % 1000000; // Ensure 6 digits by taking modulo

  return jobId;
}

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
    // if (!fs.existsSync(DEPLOY_DIR)) {
    //   fs.mkdirSync(DEPLOY_DIR);
    // }
    // check if DEPLOY_DIR + devide_id + user_id  + folder_name exists, create it if not

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


// wss.on('connection', function (ws) {
//   console.log('Client connected');

//   let logProcess = null;

//   ws.on('message', message => {
//     console.log(`Client message: ${message}`);
//     // The message is either 'start-log {deviceId}' or 'stop-log'
//     if (message.includes('start-log')) {
//       message = message.toString();
//       deviceId = message.split(' ')[1];
//       console.log('Starting log process')

//       // Start the log process on 'start-log' message
//       logProcess = spawn('rlwrap', [
//         `${CONTIKI_DIR}/tools/serial-io/serialdump`,
//         '-b115200',
//         `/dev/ttyACM${deviceId - 1}`
//       ]);

//       logProcess.stdout.on('data', (data) => {
//         console.log(`stdout: ${data}`);
//         // Send log data to all connected clients
//         wss.clients.forEach(client => {
//           if (client.readyState === WebSocket.OPEN) {
//             client.send(data);
//           }
//         });
//       });

//       logProcess.stderr.on('data', (data) => {
//         console.error(`stderr: ${data}`);
//       });

//       logProcess.on('close', (code) => {
//         if (code === 0) {
//           ws.send('Log stream closed successfully!');
//         } else {
//           ws.send('Issue connecting to the device!');
//         }
//       });
//     } else if (message == 'stop-log') {
//       // Stop the log process on 'stop-log' message
//       if (logProcess) {
//         logProcess.kill();
//       }
//     }
//   });

//   ws.on('close', () => {
//     console.log('Client disconnected');
//     // Stop the log process on client disconnect (optional)
//     if (logProcess) {
//       logProcess.kill();
//     }
//   });
// });


app.post('/api/schedule-job', function (req, res) {

  let folderName;
  let dfuUploadName;
  let deviceId;
  let duration;
  let files = [];
  // const userId = req.query.userId;
  const params = [new Date(), deviceId, folderName];
  const jobId = generateUniqueJobId(params);
  const bb = new Busboy({ headers: req.headers });
  let filePath = null;

  bb.on('field', (fieldname, value) => {
    if (fieldname === 'deviceId') {
      deviceId = value;
    } else if (fieldname === 'folderName') {
      folderName = value;
    } else if (fieldname === 'dfuUploadName') {
      dfuUploadName = value;
    }
    else if (fieldname === 'duration') {
      duration = value;
    }
    // else if (fieldname === 'jobId') {
    //   jobId = value;
    //   // Process buffered files
    //   for (let file of files) {
    //     processFile(file);
    //   }
    //   files = [];
    // }
  });

  bb.on('file', (fieldname, file, filename, encoding, mimetype) => {
    console.log("filedname",fieldname)
    const jobDir = path.join(__dirname, 'temp',jobId.toString());

    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    filePath = path.join(jobDir, fieldname);

    file.pipe(fs.createWriteStream(filePath));
    });



  bb.on('finish', () => {
    console.log('Folder Name:', folderName);
    console.log('DFU Upload Name:', dfuUploadName);
    console.log('Device ID:', deviceId);
    // console.log('User Id:', userId);
    console.log('Duration:', duration);

    if (free_at.hasOwnProperty(deviceId)) {
      let dateTime = free_at[deviceId];
      dateTime.setMinutes(dateTime.getMinutes() + 1);
      const job = schedule.scheduleJob(dateTime, function () {
        scheduleJob(filePath, folderName, dfuUploadName, deviceId, jobId, duration);
      });
      scheduled_jobs[jobId] = {
        deviceId: deviceId,
        startTime: dateTime,
        status: 'Scheduled',
        duration: duration
      }
      let newDateTime = new Date(free_at[deviceId]);
      console.log("Duration: ",duration);
      console.log(newDateTime.getSeconds());
      console.log(parseInt(newDateTime.getSeconds()) + parseInt(duration));
      newDateTime.setSeconds(parseInt(newDateTime.getSeconds()) + parseInt(duration));
      free_at[deviceId] = newDateTime;

    } else {
      let dateTime = new Date();
      dateTime.setMinutes(dateTime.getMinutes() + 1);
      const job = schedule.scheduleJob(dateTime, function () {
        scheduleJob(filePath, folderName, dfuUploadName, deviceId, jobId, duration);
      });
      scheduled_jobs[jobId] = {
        deviceId: deviceId,
        startTime: dateTime,
        status: 'Scheduled',
        duration: duration,
      }
      free_at[deviceId] = dateTime.setSeconds(dateTime.getSeconds() + duration);

    }
  })

  bb.on('error', (error) => {
    console.error(error);
    res.status(500).send('Error parsing request');
  });

  req.pipe(bb);


});

function scheduleJob(filePath, folderName, dfuUploadName, deviceId, jobId, duration) {
  clientIP = deviceSenders[deviceId].substring(7);
  //Make a post request to the client/deploy-code to notify the user
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));

  // Append other data to formData
  formData.append('folderName', folderName);
  formData.append('dfuUploadName', dfuUploadName);
  formData.append('device_id', deviceId);
  formData.append('jobId', jobId);
  formData.append('duration', duration);

  // Make a POST request using axios with FormData
  axios.post(`http://${clientIP}:${CLIENT_PORT}/deploy-code`, formData, {
    headers: {
      ...formData.getHeaders(), // Add the headers needed for FormData
    }
  }).then((response) => {
    console.log(response.data);
  }).catch((error) => {
    console.error(error);
    res.status(500).send('Error deploying code to the device!');
  });
}



app.get('/api/deviceList', function (req, res) {
  const dongleIds = Object.keys(deviceSenders);
  console.log("dongleIDS", dongleIds)
  res.json(dongleIds);
});

app.post('/api/check-availability', function (req, res) {
  // Extract node ID from request query parameters
  const deviceId = req.body.deviceId;
  const duration = req.body.duration;
  console.log("Device ID", deviceId)
  console.log("Duration", duration)

  // If nodeId is not provided, return free times for all nodes
  if (!deviceId) {
    const allNodesFreeTimes = Object.entries(free_at).map(([deviceId, freeTime]) => ({
      deviceId: deviceId,
      freeAt: freeTime
    }));
    return res.json(allNodesFreeTimes);
  }
  // Check if the provided node ID exists in the free_at dictionary
  if (!free_at.hasOwnProperty(deviceId)) {
    return res.status(404).json({ error: 'Node ID not found.' });
  }

  // Return the free time for the given node ID
  const freeTime = free_at[deviceId];
  res.json({ deviceId: deviceId, freeAt: freeTime.toLocaleString() });
});


app.post('/api/get-log', function (req, res) {
  console.log("This in is /api/get-log")
  const bb = new Busboy({ headers: req.headers });
  let jobId = null;
  let files = [];

  bb.on('field', (fieldname, value) => {
    console.log("in field /api/get-log");
    console.log(fieldname, value)
    if (fieldname === 'jobId') {
      jobId = value;
      console.log("inside the value update", jobId)
      // Process buffered files
      for (let file of files) {
        processFile(file);
      }
      files = [];
    }
  });

  bb.on('file', (fieldname, file, filename, encoding, mimetype) => {
    console.log("in file /api/get-log")

    if (jobId) {
      processFile({ fieldname, file, filename, encoding, mimetype });
    } else {
      // Buffer the file for later processing
      files.push({ fieldname, file, filename, encoding, mimetype });
    }
  });

  function processFile({ fieldname, file, filename, encoding, mimetype }) {
    const tempDir = path.join(__dirname, 'temp');
    const jobDir = path.join(tempDir, jobId);
    const logDir = path.join(jobDir, 'log');

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const filePath = path.join(logDir, filename);

    file.pipe(fs.createWriteStream(filePath));
  }

  bb.on('finish', () => {
    if (jobId === null) {
      return res.status(400).send('Job ID is required.');
    }

    if (!scheduled_jobs.hasOwnProperty(jobId)) {
      return res.status(404).send('Job ID not found.');
    }

    finished_jobs[jobId] = {
      deviceId: scheduled_jobs[jobId].deviceId,
      startTime: scheduled_jobs[jobId].startTime,
      status: 'Completed',
      duration: scheduled_jobs[jobId].duration
    };

    delete scheduled_jobs[jobId];

    res.status(200).send('Log received and job marked as completed.');
  });

  bb.on('error', (error) => {
    console.error(error);
    res.status(500).send('Error parsing request');
  });


  req.pipe(bb);
});

app.get('/api/get-log', function (req, res) {
  const jobId = req.query.jobId;
  console.log(jobId)
  const tempDir = path.join(__dirname, 'temp');
  const jobDir = path.join(tempDir, jobId); // Append jobId to the path
  const logDir = path.join(jobDir, 'log');

  // Read the contents of the log directory
  fs.readdir(logDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read log directory.' });
    }

    // Send each file in the response
    files.forEach(file => {
      const filePath = path.join(logDir, file);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          return res.status(500).json({ error: `Failed to read file: ${file}` });
        }
        // Send the file content as response
        res.attachment(file); // Set filename in response
        res.send(data);
      });
    });
  });
});

app.get('/api/scheduled', function (req, res) {
  res.json(scheduled_jobs);
});



app.get('/api/completed', function (req, res) {
  res.json(finished_jobs);
});

app.post('/api/devices', function (req, res) {
  // console.log("Request Received")
  const devices = req.body;
  const senderIP = req.ip;

  // Get all devices with sender IP in deviceSenders
  const deviceIds = Object.keys(deviceSenders).filter(deviceId => deviceSenders[deviceId] === senderIP);
  const currentTime = new Date();

  devices.forEach(device => {
    if (!deviceSenders[device.id] || free_at[device.id] < currentTime) {
      free_at[device.id] = currentTime;
    }
  });
  // Remove all devices with sender IP from deviceSenders
  deviceIds.forEach(deviceId => {
    delete deviceSenders[deviceId];
  });

  // Add all devices to deviceSenders
  devices.forEach(device => {
    deviceSenders[device.id] = senderIP;
  });

  // console.log(deviceSenders);
  res.send('Devices received');
});

app.post('/api/devicesList', function (req, res) {

});




app.get('/', function (req, res) {
  res.sendFile(__dirname + '/public/index.html');
});

http.listen(SERVER_PORT, function () {
  console.log('listening on *:', SERVER_PORT);
});



