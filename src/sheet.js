const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();


const google_sheet_url = process.env.GOOGLE_SHEET_URL; // ดึง URL ของ Google Sheet จากไฟล์ .env

const getDataFromGoogleSheet = async () => {
    try {
        const response = await axios.get(google_sheet_url);
        console.log('Data retrieved from Google Sheet:', response.data[1]);
        return response.data;
    } catch (error) {
        console.error('Error retrieving data from Google Sheet:', error);
        return null;
    }
};

const sendDataToGoogleSheet = async (data) => {
    try {
        const response = await axios.post(google_sheet_url, data);
        console.log('Data sent to Google Sheet:', response.data);
    } catch (error) {
        console.error('Error sending data to Google Sheet:', error);
    }
};

module.exports = { getDataFromGoogleSheet, sendDataToGoogleSheet };