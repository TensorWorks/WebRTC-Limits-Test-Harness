# WebRTC Stream Limits Test Harness

This code provides a test harness for empirically testing the practical upper bounds of concurrent WebRTC media streams and data channels in modern web browsers. The test harness was developed for the report [WebRTC Stream Limits Investigation](https://tensorworks.com.au/blog/webrtc-stream-limits-investigation/), which provides background information on the theoretical limits dictated by the underlying WebRTC protocol stack and presents the empirical results of running the test harness in multiple browser/sandbox/OS configurations.

The test harness runs a series of tests which steadily increase the number of data channels and then media streams until failure is detected. Each test performs the following steps:

- Establish a WebRTC peer connection with the local browser over the network loopback interface
- Negotiate the requested number of data channels and media streams
- Transmit messages over the data channels and echo them back to the sender
- Stream a local video file over the media streams (a 10-second clip from [Big Buck Bunny](https://peach.blender.org/), encoded at 1280x720 resolution with both the H.264 and VP9 video codecs)
- Tear down the peer connection to ensure a clean slate for the next test

Although every test includes both data channels and media streams, the test suite is designed to isolate their effects on one another, using only a single media stream when testing for data channel limits and a single data channel when testing for media stream limits. Due to the possibility of browser crashes or freezes when testing large numbers of concurrent media streams, data channel limits are tested first and all progress messages are also transmitted to a local webserver so they can be stored on the filesystem and inspected upon test completion. The webserver also serves the test harness over TLS using self-signed certificates to ensure browser security restrictions do not block any features required by WebRTC when not accessed over the loopback interface.


## Usage

To serve the test harness using the included webserver then you will need [Python](https://www.python.org/) 3.5 or newer and [OpenSSL](https://www.openssl.org/) to generate a self-signed TLS certificate:

- Generate a self-signed certificate by running the command `openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out cert.pem`

- Once the certificate files (`cert.pem` and `key.pem`) have been generated, install the webserver's dependencies by running `pip3 install -r requirements.txt`

- You can then start the webserver by running `python3 serve.py`

Note that the Python webserver is completely optional and is only required for the server-side logging functionality. If you simply host the files from the [static](./static) subdirectory on a site with correctly configured TLS certificates then no additional setup is required and the test harness will run as usual, albeit with server-side logging disabled.


## Legal

This repository contains clips from [Big Buck Bunny](https://peach.blender.org/), which is Copyright &copy; 2008 [The Blender Foundation](https://www.blender.org/foundation/) and is licensed under a [Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/) license.

The code used in the test suite is adapted from the [official WebRTC sample code on GitHub](https://github.com/webrtc/samples), which is copyright the WebRTC project authors and is [licensed under a BSD 3-Clause License](https://github.com/webrtc/samples/blob/gh-pages/LICENSE.md). Specifically, code has been adapted from the following samples:

- <https://github.com/webrtc/samples/blob/a88b4701a0cca3ce10c7fd038d94b81b3037b795/src/content/capture/video-pc/js/main.js>
- <https://github.com/webrtc/samples/blob/a88b4701a0cca3ce10c7fd038d94b81b3037b795/src/content/datachannel/messaging/main.js>

All remaining code is Copyright &copy; 2021 TensorWorks Pty Ltd and is [licensed under the MIT License](./LICENSE).
