var connectButton = document.getElementById("connectButton");
var bluetoothInfo = document.getElementById("bluetoothInfo");
var stats = document.getElementById("stats");
var logElement = document.getElementById("log");

const UINT16_MAX = 65536;  // 2^16
const UINT32_MAX = 4294967296;  // 2^32
const updateRatio = 0.85; // Percent ratio between old/new stats

// Bluetooth constants
const serviceUuid = "cycling_speed_and_cadence";
const characteristicUuid = "csc_measurement";

var simulate = true, duration = 0;
var characteristic, bluetoothDevice, previousSample, currentSample, bluetoothStats, hasWheel, hasCrank, startDistance, wheelSize, lastUpdate;

window.onload = () => {
    loadSettings();
    saveSettings();
    
    updateWheel();
    feather.replace();
    
    stats.innerText = metric.checked ? "0.0 km/hr\n0.00 km\n0.0 rpm\n00:00:00" : "0.0 mi/hr\n0.00 mi\n0.0 rpm\n00:00:00";
    
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

    if (navigator.battery) {
        setupBattery(navigator.battery);
      } else if (navigator.getBattery) {
        navigator.getBattery().then(setupBattery);
      }
    
    // Update clock every 5 seconds
    setIntervalImmediately(() => {
        // Got code from https://stackoverflow.com/questions/8888491/
        let date = new Date();
        let hours = date.getHours();
        let minutes = date.getMinutes();
        let ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'
        minutes = minutes < 10 ? '0'+minutes : minutes;
        time.innerHTML = hours + ':' + minutes + ' ' + ampm;
    }, 5000);
}

function setIntervalImmediately(callback, time) {
    callback();
    setInterval(callback, time);
}

function setupBattery(b) {
    battery.innerHTML = (b.level * 100).toFixed(0) + '%';
    b.addEventListener("levelchange", () => {
        battery.innerHTML = (b.level * 100).toFixed(0) + '%';
    });
}

function toggleSettings() {
    settings.classList.toggle("hidden");
}

function loadSettings() {
    rim.value = localStorage.getItem('rim') || rim.value;
    tire.value = localStorage.getItem('tire') || tire.value;
    mm.value = localStorage.getItem('mm') || mm.value;
    metric.checked = (localStorage.hasOwnProperty('metric') ? JSON.parse(localStorage.getItem('metric')) : metric.checked);
    simulate = (localStorage.hasOwnProperty('simulate') ? JSON.parse(localStorage.getItem('simulate')) : simulateCheckbox.checked);
    simulateCheckbox.checked = simulate;
}

function saveSettings() {
    localStorage.setItem('rim', rim.value);
    localStorage.setItem('tire', tire.value);
    localStorage.setItem('mm', mm.value);
    localStorage.setItem('metric', metric.checked);
    localStorage.setItem('simulate', simulateCheckbox.checked);
}

function updateSimulate() {
    saveSettings();
    window.location.reload();
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
    if (bluetoothDevice) {
        console.log('Disconnecting from bluetooth device');
        cleanup();
        return;
    }
    
    console.log('Requesting Bluetooth Device...');
    navigator.bluetooth.requestDevice({filters: [{services: [serviceUuid]}]})
    // navigator.bluetooth.requestDevice({acceptAllDevices: true})
    // the rest of the logic is inside connect()
    .then(device => {
        console.log('Connected to device', device);
        bluetoothDevice = device;
        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        connect();
    })
    .catch(error => {
        console.error('Failed to connect!', error);
        cleanup();
    });
}

function cleanup() {
    console.log('Cleaning up');
    connectButton.innerHTML = '<i data-feather="zap-off"></i>';
    feather.replace();
    if (bluetoothDevice) {
        bluetoothDevice.removeEventListener('gattserverdisconnected', onDisconnected);
        bluetoothDevice = undefined;
    }

    lastUpdate = undefined;
    
    if (characteristic) {
        characteristic.stopNotifications()
        .then(() => {
            console.log('Notifications stopped');
            characteristic.removeEventListener('characteristicvaluechanged', handleNotifications);
            characteristic = undefined;
            bluetoothStats = undefined;
        })
        .catch(error => {
            console.error('Failed to stop notifications.', error);
        });
    }
}

// Auto reconnect code from: https://googlechrome.github.io/samples/web-bluetooth/automatic-reconnect.html
function connect() {
    exponentialBackoff(3 /* max retries */, 2 /* seconds delay */,
        function toTry() {
            if (bluetoothDevice) {
                console.log('Connecting to Bluetooth Device... ');
                return bluetoothDevice.gatt.connect()
                .then(server => {
                    console.log('Getting Service...', server);
                    return server.getPrimaryService(serviceUuid);
                })
                .then(service => {
                    console.log('Getting Characteristic...', service);
                    return service.getCharacteristic(characteristicUuid);
                })
                .then(c => {
                    characteristic = c;
                    return characteristic.startNotifications().then(_ => {
                        console.log('Notifications started', characteristic);
                        characteristic.addEventListener('characteristicvaluechanged', handleNotifications);
                        connectButton.innerHTML = '<i data-feather="zap"></i>';
                        feather.replace();
                    });
                }).catch(error => {
                    console.error('Failed to connect!', error);
                    cleanup();
                });
            }
        },
        function success() {
            console.log('Bluetooth Device connected');
        },
        function fail() {
            console.log('Failed to reconnect');
            cleanup();
        });
    }
    
    function onDisconnected() {
        console.log('Bluetooth Device disconnected');
        lastUpdate = undefined;
        connect();
    }
    
    // This function keeps calling "toTry" until promise resolves or has
    // retried "max" number of times. First retry has a delay of "delay" seconds.
    // "success" is called upon success.
    function exponentialBackoff(max, delay, toTry, success, fail) {
        return toTry().then(result => success(result))
        .catch(_ => {
            if (max === 0) {
                return fail();
            }
            console.log('Retrying in ' + delay + 's... (' + max + ' tries left)');
            setTimeout(function() {
                exponentialBackoff(--max, delay * 2, toTry, success, fail);
            }, delay * 1000);
        });
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
            if (bluetoothStats.speed > 0) {
                if (!lastUpdate) lastUpdate = new Date();
                duration += (new Date() - lastUpdate);
                lastUpdate = new Date();
            }

            if (metric.checked) {
                data = bluetoothStats.speed.toFixed(1) + " km/hr\n";
                data += bluetoothStats.distance.toFixed(2) + " km\n";
            } else {
                data = (bluetoothStats.speed * 0.621371).toFixed(1) + " mi/hr\n";
                data += (bluetoothStats.distance * 0.621371).toFixed(2) + " mi\n";
            }
            data += bluetoothStats.cadence.toFixed(1) + " rpm\n";
            data += msToTime(duration);
            
            stats.innerText = data;
        }
    }

    function msToTime(duration) {
        var seconds = Math.floor((duration / 1000) % 60),
          minutes = Math.floor((duration / (1000 * 60)) % 60),
          hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
      
        hours = (hours < 10) ? "0" + hours : hours;
        minutes = (minutes < 10) ? "0" + minutes : minutes;
        seconds = (seconds < 10) ? "0" + seconds : seconds;
      
        return hours + ":" + minutes + ":" + seconds;
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
    