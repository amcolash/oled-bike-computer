var connectButton = document.getElementById("connectButton");
var bluetoothInfo = document.getElementById("bluetoothInfo");
var stats = document.getElementById("stats");
var logElement = document.getElementById("log");

const simulate = true;

const UINT16_MAX = 65536;  // 2^16
const UINT32_MAX = 4294967296;  // 2^32
const updateRatio = 0.85; // Percent ratio between old/new stats

var characteristic, bluetoothDevice, previousSample, currentSample, bluetoothStats, hasWheel, hasCrank, startDistance, wheelSize;

window.onload = () => {
    loadSettings();
    saveSettings();

    updateWheel();
    feather.replace();

    if (simulate) {
        // call a few times and repeat so ui is updated immediately
        handleNotifications();
        setIntervalImmediately(handleNotifications, 1000);
    }

    if('serviceWorker' in navigator) {
        navigator.serviceWorker.register('serviceWorker.js', {
            scope: window.location.pathname.replace('/index.html', '/')
        });
    }
}

function setIntervalImmediately(callback, time) {
    callback();
    setInterval(callback, time);
}

function toggleSettings() {
    settings.classList.toggle("hidden");
}

function loadSettings() {
    rim.value = localStorage.getItem('rim') || rim.value;
    tire.value = localStorage.getItem('tire') || tire.value;
    mm.value = localStorage.getItem('mm') || mm.value;
    metric.checked = (localStorage.hasOwnProperty('metric') ? JSON.parse(localStorage.getItem('metric')) : metric.checked);
}

function saveSettings() {
    localStorage.setItem('rim', rim.value);
    localStorage.setItem('tire', tire.value);
    localStorage.setItem('mm', mm.value);
    localStorage.setItem('metric', metric.checked);
}

function updateWheel() {
    var r = parseFloat(rim.value);
    var t = parseFloat(tire.value);
    if (r > 0 && t > 0) {
        wheelSize = Math.PI * (2 * t + r);
        mm.value = Math.round(wheelSize);
    } else {
        mm.value = '';
    }
    saveSettings();
}

function handleButton() {
    let serviceUuid = "cycling_speed_and_cadence";
    let characteristicUuid = "csc_measurement";

    log('Requesting Bluetooth Device...');
    navigator.bluetooth.requestDevice({filters: [{services: [serviceUuid]}]})
    // navigator.bluetooth.requestDevice({acceptAllDevices: true})
        .then(device => {
            bluetoothDevice = device;
            bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
            return connect();
        })
        .then(server => {
            log('Getting Service...');
            return server.getPrimaryService(serviceUuid);
        })
        .then(service => {
            log('Getting Characteristic...');
            return service.getCharacteristic(characteristicUuid);
        })
        .then(c => {
            characteristic = c;
            return characteristic.startNotifications().then(_ => {
                log('Notifications started');
                characteristic.addEventListener('characteristicvaluechanged', handleNotifications);
                connectButton.innerHTML = '<i data-feather="zap"></i>';
                feather.replace();
            });
        })
        .catch(error => {
            log('Argh! ' + error);
            cleanup();
        });
}

function cleanup() {
    log('Cleaning up');
    connectButton.innerHTML = '<i data-feather="zap-off"></i>';
    feather.replace();
    if (bluetoothDevice) {
        bluetoothDevice.removeEventListener('gattserverdisconnected', onDisconnected);
        bluetoothDevice = undefined;
    }

    if (characteristic) {
        characteristic.stopNotifications()
            .then(() => {
                log('Notifications stopped');
                characteristic.removeEventListener('characteristicvaluechanged', handleNotifications);
                characteristic = undefined;
                bluetoothStats = undefined;
            })
            .catch(error => {
                log('Argh! ' + error);
            });
    }
}

// Auto reconnect code from: https://googlechrome.github.io/samples/web-bluetooth/automatic-reconnect.html
function connect() {
    exponentialBackoff(3 /* max retries */, 2 /* seconds delay */,
      function toTry() {
        log('Connecting to Bluetooth Device... ');
        return bluetoothDevice.gatt.connect();
      },
      function success() {
        log('Bluetooth Device connected');
      },
      function fail() {
        log('Failed to reconnect');
        cleanup();
      });
  }
  
function onDisconnected() {
    log('Bluetooth Device disconnected');
    connect();
}
  
// This function keeps calling "toTry" until promise resolves or has
// retried "max" number of times. First retry has a delay of "delay" seconds.
// "success" is called upon success.
function exponentialBackoff(max, delay, toTry, success, fail) {
    toTry().then(result => success(result))
    .catch(_ => {
        if (max === 0) {
            return fail();
        }
        log('Retrying in ' + delay + 's... (' + max + ' tries left)');
        setTimeout(function() {
            exponentialBackoff(--max, delay * 2, toTry, success, fail);
        }, delay * 1000);
    });
}

function log(message) {
    console.log(message);
    if (message && message.length > 0 && logElement) {
        if (logElement.innerText.length > 0) logElement.innerText += "\n";
        logElement.innerText += message;
    }
}

function handleNotifications(event) {
    previousSample = currentSample;

    if (!simulate) {
        const value = event.target.value;
    
        const flags = value.getUint8(0, true);
        hasWheel = flags === 1 || flags === 3;
        hasCrank = flags === 2 || flags === 3;
    
        currentSample = {
            wheel: value.getUint32(1, true),
            wheelTime: value.getUint16(5, true),
            crank: value.getUint16(7, true),
            crankTime: value.getUint16(9, true),
        };
    } else {
        hasWheel = true;
        hasCrank = true;
        currentSample = {
            wheel: (previousSample ? previousSample.wheel : 0) + 2 + Math.random() * 0.5,
            wheelTime: (previousSample ? previousSample.wheelTime : 0) + 1000,
            crank: (previousSample ? previousSample.crank : 0) + 1 + Math.random() * 0.25,
            crankTime: (previousSample ? previousSample.crankTime : 0) + 1000
        }
    }


    // console.log(previousSample, currentSample);
    // var bluetoothStats = "Wheel Rev: " + currentSample.wheel + "\n";
    // bluetoothStats += "Last Wheel Time: " + currentSample.wheelTime + "\n";
    // bluetoothStats += "Crank Rev: " + currentSample.crank + "\n";
    // bluetoothStats += "Last Crank Time: " + currentSample.crankTime;
    // console.log(bluetoothStats);

    calculateStats();

    if (bluetoothStats) {
        if (metric.checked) {
            data = bluetoothStats.speed.toFixed(1) + " km/hr\n";
            data += bluetoothStats.distance.toFixed(2) + " km\n";
        } else {
            data = (bluetoothStats.speed * 0.621371).toFixed(1) + " mi/hr\n";
            data += (bluetoothStats.distance * 0.621371).toFixed(2) + " mi\n";
        }
        data += bluetoothStats.cadence.toFixed(1) + " rpm";

        stats.innerText = data;
    }
}

function diffForSample(current, previous, max) {
    if (current >= previous) {
        return current - previous;
    } else {
        return (max - previous) + current;
    }
}

function calculateStats() {
    if (!previousSample) {
        startDistance = currentSample.wheel * wheelSize / 1000 / 1000; // km
        return;
    }

    var distance, cadence, speed;
    if (hasWheel) {
        let wheelTimeDiff = diffForSample(currentSample.wheelTime, previousSample.wheelTime, UINT16_MAX);
        wheelTimeDiff /= 1024; // Convert from fractional seconds (roughly ms) -> full seconds
        let wheelDiff = diffForSample(currentSample.wheel, previousSample.wheel, UINT32_MAX);

        var sampleDistance = wheelDiff * wheelSize / 1000; // distance in meters
        speed = (wheelTimeDiff == 0) ? 0 : sampleDistance / wheelTimeDiff * 3.6; // km/hr

        distance = currentSample.wheel * wheelSize / 1000 / 1000; // km
        distance -= startDistance;
    }

    if (hasCrank) {
        let crankTimeDiff = diffForSample(currentSample.crankTime, previousSample.crankTime, UINT16_MAX);
        crankTimeDiff /= 1024; // Convert from fractional seconds (roughly ms) -> full seconds
        let crankDiff = diffForSample(currentSample.crank, previousSample.crank, UINT16_MAX);

        cadence = (crankTimeDiff == 0) ? 0 : (60 * crankDiff / crankTimeDiff); // RPM
    }

    if (bluetoothStats) {
        bluetoothStats = {
            cadence: bluetoothStats.cadence * (1 - updateRatio) + cadence * updateRatio,
            distance: distance,
            speed: bluetoothStats.speed * (1 - updateRatio) + speed * updateRatio
        };
    } else {
        bluetoothStats = {
            cadence: cadence,
            distance: distance,
            speed: speed
        };
    }
}
