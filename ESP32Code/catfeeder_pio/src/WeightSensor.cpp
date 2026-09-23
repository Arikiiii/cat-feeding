#include "WeightSensor.h"

WeightSensor::WeightSensor(uint8_t doutPin, uint8_t sckPin, float calibrationFactor)
    : _doutPin(doutPin), _sckPin(sckPin), _calibrationFactor(calibrationFactor) {}

void WeightSensor::begin() {
    _scale.begin(_doutPin, _sckPin);
    _connected = _scale.wait_ready_timeout(1000);
    _lastReadyMillis = millis();   // เพิ่มบรรทัดนี้
    if (_connected) {
        _scale.set_scale(_calibrationFactor);
        tare();
    }
}

void WeightSensor::tare(uint8_t samples) {
    if (_scale.is_ready()) {
        _scale.tare(samples);
    }
}

bool WeightSensor::update() {
    if (!_scale.is_ready()) {
        // ไม่ตัดสินว่าหลุดทันที ให้ดูว่าไม่มีข้อมูลใหม่นานเกินไปหรือยัง
        if (millis() - _lastReadyMillis > CONNECTION_TIMEOUT_MS) {
            _connected = false;
        }
        return false;
    }
    _connected = true;
    _lastReadyMillis = millis();

    long raw = _scale.get_units(1);
    _currentWeight = (float)raw;

    if (_currentWeight < 0 && _currentWeight > -1.0f) {
        _currentWeight = 0.0f;
    }
    return true;
}

float WeightSensor::getWeightGrams() const {
    return _currentWeight;
}

bool WeightSensor::isConnected() const {
    return _connected;
}
