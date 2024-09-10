const axios = require('axios');
require('dotenv').config();
const net = require('net');
const { execSync } = require('child_process');

const SERVER_IP = process.env.SERVER_IP;
const SERVER_PORT = process.env.SERVER_PORT;
const TIME_INTERVAL = process.env.TIME_INTERVAL;

function getDongles() {
  let output;
  try {
    output = execSync('bash scdev.sh').toString();
  } catch (error) {
    console.error('Error executing scdev.sh:', error);
    return [];
  }

  const dongleinfo = output.split('\n');
  let deviceList = [];

  // Remove last empty element if it exists
  dongleinfo.pop();

  if (dongleinfo.length === 0 || (dongleinfo.length === 1 && dongleinfo[0] === '')) {
    console.log('No dongles connected');
    return [];
  }

  dongleinfo.forEach(dongle => {
    const details = dongle.split(',');

    if (details.length >= 2) {  // Ensure proper parsing
      deviceList.push({
        id: details[0],
        port: details[1]
      });
    }
  });

  return deviceList;
}

function sendDevicesToServer() {
  setInterval(() => {
    const devices = getDongles();

    if (devices.length > 0) {
      axios.post(`http://${SERVER_IP}:${SERVER_PORT}/api/devices`, devices)
        .then(response => {
          console.log('Devices sent to server successfully');
        })
        .catch(error => {
          console.error('Error sending devices to server:', error);
        });
    } else {
      console.log('No devices to send.');
    }

  }, TIME_INTERVAL);
}

sendDevicesToServer();

module.exports = { sendDevicesToServer, getDongles };
