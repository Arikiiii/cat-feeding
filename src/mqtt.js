const mqtt = require('mqtt');


// ====== MQTT Client Setup ======


const mqttConnect = (mqtt_broker_url, mqttTopic, onDataReceived) => {
    const mqttClient = mqtt.connect(mqtt_broker_url);

    mqttClient.on('connect', () => {
        console.log('✅ Connected to MQTT Broker successfully!');
        mqttClient.subscribe(mqttTopic, (err) => {
            if (!err) console.log(`Subscribed to topic: ${mqttTopic}`);
        });
    });

    // ดักรับข้อความ
    mqttClient.on('message', (topic, message) => {
        const payloadString = message.toString();
        console.log(`📥 Received message from [${topic}]:`, payloadString);

        try {
            const data = JSON.parse(payloadString);

            // 1. ตรวจสอบ Field ที่จำเป็น
            if (!data.device_id || data.hopper_weight_g === undefined || data.bowl_weight_g === undefined || !data.feeder_status) {
                console.error('❌ Missing required fields in the received data.');
                return;
            }
            // 2. ตรวจสอบชนิดข้อมูล
            if (typeof data.hopper_weight_g !== 'number' || typeof data.bowl_weight_g !== 'number') {
                console.error('❌ hopper_weight_g and bowl_weight_g must be numbers.');
                return;
            }
            // 3. ตรวจสอบสถานะ
            if (!['idle', 'feeding', 'error'].includes(data.feeder_status)) {
                console.error('❌ feeder_status must be one of: idle, feeding, error.');
                return;
            }

        
            // ถ้าข้อมูลผ่านเงื่อนไขทั้งหมดแล้ว
                const validData = {
                    device_id: data.device_id,
                    hopper_weight_g: data.hopper_weight_g,
                    bowl_weight_g: data.bowl_weight_g,
                    feeder_status: data.feeder_status
                };

                // ส่งข้อมูลออกไปข้างนอกผ่าน Callback Function ที่ส่งเข้ามา
                if (typeof onDataReceived === 'function') {
                    onDataReceived(validData);
                }

        } catch (error) {
            console.error('❌ Error parsing JSON:', error.message);
        }
    });

    return mqttClient; // คืนค่า mqttClient ออกไปเผื่อเอาไว้ใช้ publish สั่งงาน
};

module.exports = { mqttConnect };