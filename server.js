
// Import the functions from sheet.js
const { mqttConnect } = require('./src/mqtt.js');
const { getDataFromGoogleSheet, sendDataToGoogleSheet } = require('./src/sheet.js');

const mqtt_broker_url = 'mqtt://broker.hivemq.com:1883';
const mqttTopic = 'catfeeder/control/status';


// ====== MQTT Client Setup =====

const client = mqttConnect(mqtt_broker_url, mqttTopic, (cleanData) => {
    console.log('📦 Data ready for Google Sheet:', cleanData);
    // เอา cleanData ไปยิงเข้า Google Sheets ต่อตรงนี้ได้เลย!
    console.log('Sending data to Google Sheet...');
    sendDataToGoogleSheet(cleanData);
});







