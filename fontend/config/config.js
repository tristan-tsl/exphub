let host = window.location.host;
if (host.indexOf(":") > -1) {
    host = "localhost";
}
host += ":8081";
const serverIp = "http://" + host;
const ossFilePrefix = "http://authbook-publiclib.oss-cn-beijing.aliyuncs.com/";
