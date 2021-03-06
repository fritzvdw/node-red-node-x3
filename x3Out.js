"use strict";
/**
 * Copyright 2013, 2015 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    "use strict";
    var http = require("follow-redirects").http;
    var https = require("follow-redirects").https;
    var urllib = require("url");
    var mustache = require("mustache");
    var querystring = require("querystring");

    // hard code test httprequest

    function X3Config(n){
        //console.log("N:",n);
        RED.nodes.createNode(this,n);
        this.baseUrl = n.baseUrl;
        this.endpoint = n.endpoint;
        this.credentials = {
            user: n.user,
            passwd: n.password
        };
    }


    function X3Out(n) {

        function sendRequest(opt) {
            var msg = opt.msg;

            var nodeUrl = opt.url;
            var isTemplatedUrl = (nodeUrl||"").indexOf("{{") != -1;
            var handlerEnd = opt.handlerEnd || function(){  msg.payload = null };
            var preRequestTimestamp = process.hrtime();
            node.status({fill:"blue",shape:"dot",text:"httpin.status.requesting"});
            var url = nodeUrl || msg.url;
            if (msg.url && nodeUrl && (nodeUrl !== msg.url)) {  // revert change below when warning is finally removed
                node.warn(RED._("common.errors.nooverride"));
            }
            if (isTemplatedUrl) {
                url = mustache.render(nodeUrl,msg);
            }
            //console.log("is Template", isTemplatedUrl, "url", url, "msg", msg);
            if (!url) {
                node.error(RED._("httpin.errors.no-url"),msg);
                return;
            }
            // url must start http:// or https:// so assume http:// if not set
            if (!((url.indexOf("http://") === 0) || (url.indexOf("https://") === 0))) {
                url = "http://"+url;
            }

            var opts = urllib.parse(url);
            var crud = opt.method && opt.method.toUpperCase() || "READ";
            switch(crud) {
                case 'CREATE':
                    opts.method = "POST";
                    break;
                case 'UPDATE':
                    opts.method = "PUT";
                    break;
                default: 
                    opts.method = "GET";
                    break;
            }
            opts.headers = {};
            if (msg.headers) {
                for (var v in msg.headers) {
                    if (msg.headers.hasOwnProperty(v)) {
                        var name = v.toLowerCase();
                        if (name !== "content-type" && name !== "content-length") {
                            // only normalise the known headers used later in this
                            // function. Otherwise leave them alone.
                            name = v;
                        }
                        opts.headers[name] = msg.headers[v];
                    }
                }
            }
            if (/*!self.cookie && */credentials && credentials.user) {
                opts.auth = credentials.user+":"+(credentials.passwd||"");
            }else{
                //opts.headers.cookie = self.cookie;
            }
            if (self.cookie) opts.headers.cookie = self.cookie;
            var payload = null;

            if (msg.payload ) {// analyse the content we can receive payload for POST, PUT or GET.

                if (typeof msg.payload === "string" || Buffer.isBuffer(msg.payload)) {
                    payload = msg.payload;
                } else if (typeof msg.payload == "number") {
                    payload = msg.payload+"";
                } else {
                    if (opts.headers['content-type'] == 'application/x-www-form-urlencoded') {
                        payload = querystring.stringify(msg.payload);
                    } else {
                        payload = JSON.stringify(msg.payload);
                        if (opts.headers['content-type'] == null) {
                            opts.headers['content-type'] = "application/json";
                        }
                    }
                }
                // add the key if we want to read or update
/*                if( nodeMethod === "GET" || nodeMethod === "PUT" )
                    nodeUrl += "('"+payload+"')?representation="+representation+"."+(nodeMethod !== "PUT"  ? "$details": "$edit");
                else if( nodeMethod === "POST" ){
                    nodeUrl += "?representation="+representation;
                }*/
                if (opts.headers['content-length'] == null) {
                    if (Buffer.isBuffer(payload)) {
                        opts.headers['content-length'] = payload.length;
                    } else {
                        opts.headers['content-length'] = Buffer.byteLength(payload);
                    }
                }
            }
            var urltotest = url;
            var noproxy;
            if (noprox) {
                for (var i in noprox) {
                    if (url.indexOf(noprox[i]) !== -1) { noproxy=true; }
                }
            }
            if (prox && !noproxy) {
                var match = prox.match(/^(http:\/\/)?(.+)?:([0-9]+)?/i);
                if (match) {
                    //opts.protocol = "http:";
                    //opts.host = opts.hostname = match[2];
                    //opts.port = (match[3] != null ? match[3] : 80);
                    opts.headers['Host'] = opts.host;
                    var heads = opts.headers;
                    var path = opts.pathname = opts.href;
                    opts = urllib.parse(prox);
                    opts.path = opts.pathname = path;
                    opts.headers = heads;
                    opts.method = method;
                    //console.log(opts);
                    urltotest = match[0];
                }
                else { node.warn("Bad proxy url: "+process.env.http_proxy); }
            }
            opts.headers['content-type'] = "application/json";
            opts.headers.accept = "application/json;vnd.sage=syracuse";
            //console.log("request opts", opts);
            var req = ((/^https/.test(urltotest))?https:http).request(opts,function(res) {
                (node.ret === "bin") ? res.setEncoding('binary') : res.setEncoding('utf8');

                msg.statusCode = res.statusCode;
                msg.headers = res.headers;
                //if(!self.cookie )
                    self.cookie = res.headers["set-cookie"];
    
                msg.payload = "";
                // msg.url = url;   // revert when warning above finally removed
                res.on('data',function(chunk) {
                    //console.log("data", chunk);
                    msg.payload += chunk;
                });
                res.on('end', function() { handlerEnd(res); });
            });
            req.setTimeout(node.reqTimeout, function() {
                node.error(RED._("common.notification.errors.no-response"),msg);
                setTimeout(function() {
                    node.status({fill:"red",shape:"ring",text:"common.notification.errors.no-response"});
                },10);
                req.abort();
            });
            req.on('error',function(err) {
                msg.payload = err.toString() + " : " + url;
                msg.statusCode = err.code;
                node.send(msg);
                node.status({fill:"red",shape:"ring",text:err.code});
            });
            if (payload) {
                req.write(payload);
            }
            req.end();
        };
        
        RED.nodes.createNode(this,n);
        this.x3Config = RED.nodes.getNode(n.config);
        var self = this;

        var baseUrl =  this.x3Config &&  this.x3Config.baseUrl || "http://52.30.57.116:8124";
        //var url =  this.x3Config &&  this.x3Config.url || "http://52.30.57.116:8124";

        var endpoint =  this.x3Config &&  this.x3Config.endpoint || "x3/erp/X3U9REF_SEED";
        //var endpoint =  this.x3Config &&  this.x3Config.endpoint || "syracuse/collaboration/syracuse";
        var credentials =  this.x3Config &&   this.x3Config.credentials || {user:"admin",passwd:"admin"};
        var classe = n.class;
        var representation = n.representation || classe;
        var keyWhere = n.key;
        var facet = n.facet;

        var nodeMethod = n.method || "GET";

        var url;
        switch(facet) {
            case "details":
            case "edit":
                url = baseUrl+"/sdata/"+endpoint+"/"+representation + "('"+keyWhere+"')?representation=" + representation + ".$" + facet;
                break;
           default:
                url = baseUrl+"/sdata/"+endpoint+"/"+representation + "?representation=" + representation + ".$" + facet;
                if (keyWhere) url += "&where=("+keyWhere+")";
                break;
        }
       
        this.ret = n.ret || "txt";
        if (RED.settings.httpRequestTimeout) { this.reqTimeout = parseInt(RED.settings.httpRequestTimeout) || 120000; }
        else { this.reqTimeout = 120000; }
        var node = this;

        var prox, noprox;
        if (process.env.http_proxy != null) { prox = process.env.http_proxy; }
        if (process.env.HTTP_PROXY != null) { prox = process.env.HTTP_PROXY; }
        if (process.env.no_proxy != null) { noprox = process.env.no_proxy.split(","); }
        if (process.env.NO_PROXY != null) { noprox = process.env.NO_PROXY.split(","); }

        this.on("input",function(msg){
            // request to X3
            sendRequest({method: nodeMethod, 
                         msg : msg, 
                         url: url,
                         handlerEnd:function(res) {
                                if (node.metric()) {
                                    // Calculate request time
                                    var diff = process.hrtime(preRequestTimestamp);
                                    var ms = diff[0] * 1e3 + diff[1] * 1e-6;
                                    var metricRequestDurationMillis = ms.toFixed(3);
                                    node.metric("duration.millis", msg, metricRequestDurationMillis);
                                    if (res.client && res.client.bytesRead) {
                                        node.metric("size.bytes", msg, res.client.bytesRead);
                                    }
                                }

                                //console.log("data", msg.payload);
                                if ((res.headers['content-type'] || "").indexOf("application/json") != -1) {
                                    try { msg.payload = JSON.parse(msg.payload); }
                                    catch(e) { node.warn(RED._("httpin.errors.json-error")); }
                                } else if (node.ret === "bin") {
                                    msg.payload = new Buffer(msg.payload,"binary");
                                }
                                node.send(msg);
                                node.status({});
                                //
                                // request logout 
                                //console.log("cookie logout", res.headers['set-cookie']);
                                var hh = res.headers['set-cookie'] ? {cookie: res.headers['set-cookie']} : {};
                                msg.headers = hh;
                                sendRequest({method: "POST", msg : msg, url: url+"/logout", headers: hh});  
                            }
                        });

        });
    }

    RED.nodes.registerType("x3 out",X3Out);
    RED.nodes.registerType("x3 function",X3Out);

    RED.nodes.registerType("x3-config",X3Config,{
        credentials: {
            user: {type:"text"},
            password: {type: "password"}
        }
    });



    RED.httpAdmin.get("/representations", function(req,res) {
        var config = req.query.config;

        var cnf = RED.nodes.getNode(config);

        var url = cnf.baseUrl + "/sdata/syracuse/collaboration/syracuse/representationProxies?representation=representationProxy.$lookup&count=3000&dataset=" + cnf.endpoint.split('/')[2];
        var opts = urllib.parse(url);
        opts.method = 'GET';
        opts.auth = cnf.credentials.user+":"+(cnf.credentials.passwd||"");
        opts.headers = {
            accept: "application/json"
        };

        //console.log("opts", opts);
        var syrreq = http.request(opts,function(syrres) {
            var payload = "";
            syrres.on('data',function(chunk) {
               // console.log("data", chunk);
                payload += chunk;
            });
            syrres.on('end',function() {
                //console.log("end");
                try { 
                    payload = JSON.parse(payload); 
                    //console.log("Payload: "+JSON.stringify(payload,null,2));
                    var reprs = [];
                    payload.$resources && payload.$resources.forEach(function(r) {
                        reprs.push(r.entity);
                    });
                    res.json(reprs);
                } catch(e) {
                    node.warn(RED._("httpin.errors.json-error"));
                }
                
                
            });
        });

        syrreq.on('error',function(err) {
            node.warn(RED._("httpin.errors.json-error"));
        });
        syrreq.end();
    });
    
};
