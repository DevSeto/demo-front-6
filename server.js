var path = require('path');
var url = require('url');
var express = require('express');
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs = require('fs');
var https = require('https');
var querystring = require('querystring');
var chmodr = require('chmodr');


var config = require('./myConfig.js');
var credentials = {
    key:  fs.readFileSync('/etc/letsencrypt/live/webinera.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/webinera.com/fullchain.pem')
};
var WebSocketServer = ws.Server;
var app = express();
var server = https.createServer(credentials, app)
    .listen(config.wssPort);
var wss = new WebSocketServer({
    server: server,
    path: '/' + config.wssPath
});
/*
 * Definition of global variables.
 */

var kurentoClient = null;
var mediaPipeline = null;
var composite = null;
var resultPort = null;
var recorderEndpoint = null;

var allConnections = {};
var allStreamers = {};
var allViewers = {};

var _wsParams = {
    webinarId: null,
    userId: null,
    index: null,
    webRtcEndpoint: null,
    hubPort: null,
    candidates: []
};

function initComponents(webinarId, callback){
    console.log('wiiiiiiiisad',kurentoClient && mediaPipeline && composite)

    if(kurentoClient && mediaPipeline && composite){
        callback(null);
    }else{
        getKurentoClient(function(error){
            if(error){
                return callback(error);
            }
            getMediaPipeline(function(error){
                if(error){
                    return callback(error);
                }
                getComposite(function(error){
                    if(error){
                        return callback(error);
                    }

                    composite.createHubPort(function(error, _hubPort){
                        console.info("Creating result hubPort ...");
                        if (error) {
                            return callback(error);
                        }
                        resultPort = _hubPort;

                        var d = new Date();
                        // var filename = d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate()+'-'+d.getHours()+'-'+d.getMinutes()+'-'+d.getSeconds()+ ".mp4";
                        var filename = 'webinera-'+ webinarId+".mp4";


                        var func = function(fileUri){
                            var recorderParams = {
                                mediaProfile: 'MP4',
                                uri : fileUri
                            };
                            console.log('fileUri',recorderParams)

                            mediaPipeline.create('RecorderEndpoint', recorderParams, function(error, _recorderEndpoint){
                                console.info("Creating result RecorderEndpoint ...",error);
                                if (error) {
                                    return callback(error);
                                }

                                recorderEndpoint = _recorderEndpoint;
                                resultPort.connect(recorderEndpoint);

                                return callback(null);
                            });
                        }

                        var dir = '/var/www/html/api/public/tmp_streams/' + webinarId;
                        var fileUri = 'file://'+dir+'/'+filename;
                        dirSndFilename = dir+'/'+filename
                        console.log('232sdfsdf',fs.existsSync(dir),fileUri)

                        if (!fs.existsSync(dir)){
                            fs.mkdir(dir, function(err) {

                                chmodr(dir, 0777, function (err) {
                                    func(fileUri);
                                })
                            });
                        }else{
                            func(fileUri);
                        }


                    });

                });
            })
        });
    }
}

/*
 * Management of WebSocket messages
 */
wss.on('connection', function(ws) {

 event(ws);
});

function event(ws) {
    var urlObject = url.parse(ws.upgradeReq.url);
    var querystringObject = querystring.parse(urlObject.query);

    if(!querystringObject.webinarId){
        ws.close(1001,'webinar_udefined');
    }else if(!querystringObject.userId){
        ws.close(1002,'user_udefined');
    }

    var connectionIndex = querystringObject.webinarId + '_' + querystringObject.userId;


    if(allConnections[connectionIndex]){
        console.log('user_already_connected ' + connectionIndex);
        ws.close(1003,'user_already_connected');
    }

    ws.wsParams = JSON.parse(JSON.stringify(_wsParams));
    ws.wsParams.index = connectionIndex;
    ws.wsParams.webinarId = querystringObject.webinarId;
    ws.wsParams.userId = querystringObject.userId;
    allConnections[connectionIndex] = ws;
    console.log('allConnections',allConnections)

    //
    // console.log("allConnections  allConnections= " + " " + Object.keys(allConnections).length + " allStreamers = " + " " + Object.keys(allStreamers).length + " allViewers = " + " " + Object.keys(allViewers).length);

    ws.on('error', function(error) {
        console.log('Connection error');
        console.log(error);
        stop(ws);
    });

    ws.on('close', function(e,ms) {
        console.log('Connection closed',e,ms);
        stop(ws, true);
    });

    ws.on('message', function(_message) {
        var message = JSON.parse(_message);

        switch (message.id) {
            case 'client':
            case 'streamer':
                console.log('MESSAGE  streamer... ' + message.id,ws.wsParams.webinarId);
                // console.log(ws.wsParams.webinarId);

                initComponents(ws.wsParams.webinarId, function(error){
                    if(error){
                        console.log("===== ERROR ..... =====");
                        console.log(error);
                    }else{
                        addClient(ws, message.sdpOffer, function(error, sdpAnswer) {
                            if (error) {
                                return ws.send(JSON.stringify({
                                    id: 'response',
                                    response: 'rejected',
                                    message: error
                                }));
                            }
                            if(allViewers[ws.wsParams.index]){
                                delete allViewers[ws.wsParams.index];
                            }

                            console.log('new streamer ' + ws.wsParams.index);
                            allStreamers[ws.wsParams.index] = ws;

                            console.log("allConnections = " + " " + Object.keys(allConnections).length + " allStreamers = " + " " + Object.keys(allStreamers).length + " allViewers = " + " " + Object.keys(allViewers).length);

                            ws.send(JSON.stringify({
                                id: 'response',
                                response: 'accepted',
                                sdpAnswer: sdpAnswer
                            }));
                        });
                    }
                });


                break;

            case 'viewer':
                console.log('viewer MESSAGE ... ' + message.id,ws.wsParams);
                // console.log(ws.wsParams.webinarId);
                // if(!allStreamers[ws.wsParams.index]){
                //     return ws.send(JSON.stringify({
                //         id: 'response',
                //         response: 'rejected',
                //         message: ''
                //     }));
                // }
                initComponents(ws.wsParams.webinarId, function(error){
                    if(error){
                        console.log("===== ERROR ..... =====viewer");
                        console.log(error);
                    }else{
                        addViewer(ws, message.sdpOffer, function(error, sdpAnswer) {
                            if (error) {
                                return ws.send(JSON.stringify({
                                    id: 'response',
                                    response: 'rejected',
                                    message: error
                                }));
                            }
                            if(allStreamers[ws.wsParams.index]){
                                delete allStreamers[ws.wsParams.index];
                            }


                            console.log('new viewer ' + ws.wsParams.index);
                            allViewers[ws.wsParams.index] = ws;

                            console.log("allConnections = " + " " + Object.keys(allConnections).length + " allStreamers = " + " " + Object.keys(allStreamers).length + " allViewers = " + " " + Object.keys(allViewers).length);

                            ws.send(JSON.stringify({
                                id: 'response',
                                response: 'accepted',
                                sdpAnswer: sdpAnswer
                            }));
                        });
                    }
                });

                break;

            case 'stop':
                console.log('MESSAGE ... ' ,JSON.stringify(message));

                stop(ws);
                break;

            case 'onIceCandidate':
                console.log('MESSAGE ..onIceCandidate. ' + message.id,ws.wsParams);

                onIceCandidate(ws, message.candidate);
                break;

            default:
                console.log('MESSAGE ...');
                console.log(message);

                ws.send(JSON.stringify({
                    id: 'error',
                    message: 'Invalid message ' + message.id
                }));
                break;
        }
    });
}
/*
 * Definition of functions
 */

// Retrieve or create kurentoClient
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        console.log("KurentoClient already created");
        return callback(null, kurentoClient);
    }

    kurento(config.kurentoServer, function(error, _kurentoClient) {
        console.log("creating KurentoClient ...");
        if (error) {
            console.log("Coult not find media server at address " + config.kurentoServer);
            return callback("Could not find media server at address" + config.kurentoServer +
                ". Exiting with error " + error);
        }
        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

// Retrieve or create mediaPipeline
function getMediaPipeline(callback) {
    if (mediaPipeline !== null) {
        console.log("MediaPipeline already created");
        return callback(null, mediaPipeline);
    }
    getKurentoClient(function(error, _kurentoClient) {
        if (error) {
            return callback(error);
        }
        _kurentoClient.create('MediaPipeline', function(error, _pipeline) {
            console.log("creating MediaPipeline ...");
            if (error) {
                return callback(error);
            }
            mediaPipeline = _pipeline;
            callback(null, mediaPipeline);
        });
    });
}

// Retrieve or create composite hub
function getComposite(callback) {
    if (composite !== null) {
        console.log("Composer already created");
        return callback(null, composite, mediaPipeline);
    }
    getMediaPipeline(function(error, _pipeline) {
        if (error) {
            return callback(error);
        }
        _pipeline.create('Composite', function(error, _composite) {
            console.log("creating Composite ...");
            if (error) {
                return callback(error);
            }
            composite = _composite;
            callback(null, composite);
        });
    });
}



// Add a webRTC client
function addViewer(ws, sdp, callback) {

    mediaPipeline.create('WebRtcEndpoint', function(error, _webRtcEndpoint) {
        _webRtcEndpoint.setMaxVideoSendBandwidth(700)
        _webRtcEndpoint.setMinVideoSendBandwidth(500)
        _webRtcEndpoint.setOutputBitrate(800)
        if (error) {
            return callback(error);
        }

        if (ws.wsParams.candidates.length) {
            var candidate = ws.wsParams.candidates.shift();
            _webRtcEndpoint.addIceCandidate(candidate);
        }

        ws.wsParams.webRtcEndpoint = _webRtcEndpoint;
        _webRtcEndpoint.on('OnIceCandidate', function(event) {
            var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
            ws.send(JSON.stringify({
                id: 'iceCandidate',
                candidate: candidate
            }));
        });

        _webRtcEndpoint.processOffer(sdp, function(error, sdpAnswer) {
            if (error) {
                stop(ws);
                console.log("Error processing offer " + error);
                return callback(error);
            }

            callback(null, sdpAnswer);
        });

        _webRtcEndpoint.gatherCandidates(function(error) {
            if (error) {
                return callback(error);
            }
        });

        console.log('connect viewer');
        resultPort.connect(_webRtcEndpoint);
    });
}

// Add a webRTC client
function addClient(ws, sdp, callback) {

    mediaPipeline.create('WebRtcEndpoint', function(error, _webRtcEndpoint) {
        console.info("Creating streamer createWebRtcEndpoint");
        if (error) {
            return callback(error);
        }

        if (ws.wsParams.candidates.length) {
            var candidate = ws.wsParams.candidates.shift();
            _webRtcEndpoint.addIceCandidate(candidate);
        }

        ws.wsParams.webRtcEndpoint = _webRtcEndpoint;
        _webRtcEndpoint.on('OnIceCandidate', function(event) {
            var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
            ws.send(JSON.stringify({
                id: 'iceCandidate',
                candidate: candidate
            }));
        });

        _webRtcEndpoint.processOffer(sdp, function(error, sdpAnswer) {
            if (error) {
                stop(ws);
                console.log("Error processing offer " + error);
                return callback(error);
            }

            callback(null, sdpAnswer);
        });

        _webRtcEndpoint.gatherCandidates(function(error) {
            if (error) {
                return callback(error);
            }
        });

        composite.createHubPort(function(error, _hubPort) {
            console.info("Creating result hubPort");
            if (error) {
                return callback(error);
            }

            if (error) {
                stop(ws);
                console.log("Error creating HubPort " + error);
                return callback(error);
            }
            ws.wsParams.hubPort = _hubPort;
            _webRtcEndpoint.connect(ws.wsParams.hubPort);
            ws.wsParams.hubPort.connect(_webRtcEndpoint);

            console.log('record stream ' + ws.wsParams.index);
            recorderEndpoint.record();

            console.log('connect streamer');
        });
    });
}

// Stop and remove a webRTC client
function stop(ws, delSocketConn) {

    if (ws.wsParams.webRtcEndpoint) {
        ws.wsParams.webRtcEndpoint.release();
    }

    if (ws.wsParams.hubPort) {
        ws.wsParams.hubPort.release();
    }

    var index = ws.wsParams.index;

    if(allStreamers[index]){
        console.log("delete streamer " + index);
        delete allStreamers[index]
    }
    if(allViewers[index]){
        console.log("delete viewer " + index);
        delete allViewers[index];
    }

    if(!Object.keys(allStreamers).length && recorderEndpoint){
        console.log('stop record stream ' + ws.wsParams.index);
        recorderEndpoint.pause();
    }

    console.log("allConnections = " + " " + Object.keys(allConnections).length + " allStreamers = " + " " + Object.keys(allStreamers).length + " allViewers = " + " " + Object.keys(allViewers).length);

    if(delSocketConn){
        console.log("delete connection ... ");

        if(allConnections[index]){
            console.log("delete connection " + index);
            delete allConnections[index];
        }

        console.log("allConnections = " + " " + Object.keys(allConnections).length + " allStreamers = " + " " + Object.keys(allStreamers).length + " allViewers = " + " " + Object.keys(allViewers).length);

        if(!Object.keys(allConnections).length){

            if(recorderEndpoint){
                console.log("release recorderEndpoint");
                recorderEndpoint.release();
                recorderEndpoint = null;
            }

            if(resultPort){
                console.log("release result port");
                resultPort.release();
                resultPort = null;
            }

            if (composite){
                console.log("release composite");
                composite.release();
                composite = null;
            }

            if (mediaPipeline){
                console.log("release mediaPipeline");
                mediaPipeline.release();
                mediaPipeline = null;
            }

        }
    }

}

function onIceCandidate(ws, _candidate){
    var candidate = kurento.register.complexTypes.IceCandidate(_candidate);
    console.log('onIceCandidate',candidate)
    if (ws.wsParams.webRtcEndpoint) {
        //	console.info('Sending candidate');
        ws.wsParams.webRtcEndpoint.addIceCandidate(candidate);
    } else {
        //	console.info('Queueing candidate');
        ws.wsParams.candidates.push(candidate);
    }
}


app.use(express.static(path.join(__dirname, 'static')));