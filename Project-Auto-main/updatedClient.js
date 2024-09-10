const axios = require('axios');
require('dotenv').config();
const { execSync } = require('child_process');

const SERVER_IP = process.env.SERVER_IP;
const SERVER_PORT = process.env.SERVER_PORT;
const TIME_INTERVAL = process.env.TIME_INTERVAL || 5000; // Default to 5 seconds if not set

/**
 * Function to retrieve connected dongles by running a shell script.
 * The shell script outputs dongle details that are parsed and returned as an array.
 * @returns {Array} List of connected dongles in the format [{id, port}]
 */
function getDongles() {
  let output;
  try {
    // Execute shell script to get dongle information
    output = execSync('bash scdev.sh').toString();
  } catch (error) {
    console.error('Error executing scdev.sh:', error);
    return [];
  }

  const dongleinfo = output.split('\n'); // Split each line of the shell script output
  let deviceList = [];

  // Remove the last empty element if it exists
  dongleinfo.pop();

  // If no dongles are connected or output is invalid, return empty array
  if (dongleinfo.length === 0 || (dongleinfo.length === 1 && dongleinfo[0] === '')) {
    console.log('No dongles connected');
    return [];
  }

  // Parse each dongle's details from the output
  dongleinfo.forEach(dongle => {
    const details = dongle.split(',');

    if (details.length >= 2) {  // Ensure the parsed details are valid
      deviceList.push({
        id: details[0],     // Dongle ID
        port: details[1]    // Corresponding port
      });
    }
  });

  return deviceList;  // Return the list of detected dongles
}

/**
 * Function to send connected dongles to the server at regular intervals.
 * The list of connected dongles is retrieved and posted to the server.
 */
function sendDevicesToServer() {
  setInterval(() => {
    const devices = getDongles();  // Get the list of currently connected dongles

    // If there are devices to send, post them to the server
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

  }, TIME_INTERVAL);  // Repeat the process every TIME_INTERVAL milliseconds
}

// Start sending the connected dongles to the server
sendDevicesToServer();

// Export the functions for use in other parts of the application
module.exports = { sendDevicesToServer, getDongles };
