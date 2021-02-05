/*
	The code used in this test suite is adapted from the official WebRTC sample code on GitHub, which is copyright the WebRTC project authors
	and is licensed under a BSD 3-Clause License (see <https://github.com/webrtc/samples/blob/gh-pages/LICENSE.md> for details.)
	
	Specifically, code has been adapted from the following samples:
	
	- <https://github.com/webrtc/samples/blob/a88b4701a0cca3ce10c7fd038d94b81b3037b795/src/content/capture/video-pc/js/main.js>
	- <https://github.com/webrtc/samples/blob/a88b4701a0cca3ce10c7fd038d94b81b3037b795/src/content/datachannel/messaging/main.js>
*/
'use strict';


// Provides utility functionality for working with promises
class PromiseUtils
{
	// Returns a Promise that will be resolved after the specified timeout
	static waitForMilliseconds(delay)
	{
		return new Promise((resolve, _) => {
			window.setTimeout(resolve, delay);
		});
	}
	
	// Returns a Promise that will be resolved when the supplied function returns true
	// (Based on the example here: <https://stackoverflow.com/a/45489272>)
	static waitForCondition(cond)
	{
		return new Promise((resolve, reject) =>
		{
			function performCheck()
			{
				try
				{
					if (cond() === true) {
						resolve();
					}
					else {
						window.setTimeout(performCheck, 1000);
					}
				}
				catch (err) {
					reject(err);
				}
			}
			
			performCheck();
		});
	}
	
	// Returns a Promise that will be resolved when the specified event is fired by the supplied EventTarget
	static waitForEvent(target, successEvent, failureEvent)
	{
		return new Promise((resolve, reject) =>
		{
			try
			{
				// Add an event handler for the event that signals success
				target.addEventListener(
					successEvent,
					() => { resolve(); },
					{once: true}
				);
				
				// If an event was specified that signals failure, add an event handler for that too
				if (failureEvent !== undefined)
				{
					target.addEventListener(
						failureEvent,
						() => { reject(new Error(`failure event triggered ("${failureEvent}")`)); },
						{once: true}
					);
				}
			}
			catch (err) {
				reject(err);
			}
		});
	}
}


// Encapsulates a single run in our test suite for examining the limits of bi-directional WebRTC communication
class WebRtcLimitTestRun
{
	// Configures the test suite with the specified values
	constructor(containerElemLocal, containerElemRemote, localVideoURLs, numMediaStreams, numDataChannels)
	{
		this._events = new EventTarget();
		this._localConnection = null;
		this._remoteConnection = null;
		this._dataChannels = [];
		this._localVideoElems = [];
		this._remoteVideoElems = [];
		this._mediaStreams = [];
		this._mediaDuration = 0.0;
		
		// Store a reference the container elements in which we will place generated HTML elements
		this._containerLocal = $(containerElemLocal);
		this._containerRemote = $(containerElemRemote);
		
		// Store the list of URLs for the video file which will act as the source of our "local" peer's media stream
		// (Note that we take a list of URLs so we can provide multiple codec options, e.g. H.264 and VP9)
		this._localVideoURLs = localVideoURLs;
		
		// Keep track of how many simultaneous WebRTC media streams we should attempt to transmit
		this._numMediaStreams = numMediaStreams;
		
		// Keep track of how many simultaneous WebRTC data channels we should attempt to create
		this._numDataChannels = numDataChannels;
	}
	
	// Returns the duration (in seconds) of the video file that was used during the test run
	// (This will return 0 if called prior to test run completion)
	getMediaDuration() {
		return this._mediaDuration;
	}
	
	// Runs our test suite
	async run()
	{
		try
		{
			// Create the "local" and "remote" ends of our WebRTC peer connection
			console.log('[Test Harness] Performing setup...');
			await this._setup();
			
			// Create our data channels
			console.log(`[Test Harness] Creating ${this._numDataChannels} data channels...`);
			for (let index = 0; index < this._numDataChannels; ++index) {
				this._createDataChannel();
			}
			
			// Create the promises for detecting our data channel lifecycle events
			// (We do this prior to yielding for anything else to ensure our event handlers are registered prior to any of the events actually being fired)
			// (Note that we specify a failure event for the first promise, so we can detect failures when we have more data channels than the browser supports)
			let promiseLocalOpen = Promise.all(this._dataChannels.map((_, index) => PromiseUtils.waitForEvent(this._events, `channel-open-local-${index}`, `channel-closed-local-${index}`)));
			let promiseRemoteOpen = Promise.all(this._dataChannels.map((_, index) => PromiseUtils.waitForEvent(this._events, `channel-open-remote-${index}`, `channel-closed-local-${index}`)));
			let promiseRemoteReceived = Promise.all(this._dataChannels.map((_, index) => PromiseUtils.waitForEvent(this._events, `data-received-remote-${index}`, `channel-closed-local-${index}`)));
			let promiseLocalReceived = Promise.all(this._dataChannels.map((_, index) => PromiseUtils.waitForEvent(this._events, `data-received-local-${index}`, `channel-closed-local-${index}`)));
			let promiseLocalClosed = Promise.all(this._dataChannels.map((_, index) => PromiseUtils.waitForEvent(this._events, `channel-closed-local-${index}`)));
			let promiseRemoteClosed = Promise.all(this._dataChannels.map((_, index) => PromiseUtils.waitForEvent(this._events, `channel-closed-remote-${index}`)));
			
			// Perform connection negotiation
			console.log('[Test Harness] Connecting to WebRTC peer...');
			await this._connect();
			
			// If we're testing more than one data channel then set a timeout for opening all of the channels
			// (This allows us to detect failures in browsers that don't automatically close the channels)
			let failureTimeout = null;
			if (this._numDataChannels > 1)
			{
				failureTimeout = window.setTimeout(() =>
					{
						console.log('[Test Harness] Timeout detected while opening data channels!');
						this._events.dispatchEvent(new Event(`channel-closed-local-${this._numDataChannels - 1}`));
					},
					60 * 1000
				);
			}
			
			// Wait for both ends our data channels to be open
			console.log('[Test Harness] Waiting for data channels to be open...');
			await promiseLocalOpen;
			await promiseRemoteOpen;
			
			// Clear the failure timeout once the data channels are open
			if (failureTimeout !== null) {
				window.clearTimeout(failureTimeout);
			}
			
			// Start playing our local media streams and transmitting them over the WebRTC peer connection
			console.log('[Test Harness] Playing local media streams...');
			for (let elem of this._localVideoElems) {
				await elem.play();
			}
			
			// Transmit messages over each of our data channels
			console.log('[Test Harness] Trasmitting messages over data channels...');
			for (let index = 0; index < this._dataChannels.length; ++index) {
				this._dataChannels[index]['local'].send(`Message for channel ${index}`);
			}
			
			// Wait for all of the messages to be received and echoed back
			console.log('[Test Harness] Waiting for messages to be received and echoed...');
			await promiseRemoteReceived;
			await promiseLocalReceived;
			
			// Wait for the media streams to complete playback
			console.log('[Test Harness] Waiting for local media streams to complete playback...');
			for (let elem of this._localVideoElems)
			{
				// Note that this method of detecting playback completion is necessary because some browsers fail to fire the `ended` event
				// or set the ended attribute to true when we are testing a large number of concurrent media streams, presumably due to bugs
				await PromiseUtils.waitForCondition(() => { return (elem.ended === true || (elem.duration - elem.currentTime) < 0.1); });
			}
			await PromiseUtils.waitForMilliseconds(1000);
			
			// Disconnect
			console.log('[Test Harness] Disconnecting from WebRTC peer...');
			this._disconnect();
			
			// Wait for both ends of our data channels to be closed
			console.log('[Test Harness] Waiting for data channels to be closed...');
			await promiseLocalClosed;
			await promiseRemoteClosed;
		}
		catch (err)
		{
			// Propagate any errors
			console.log('Propagating error: ', err);
			this._disconnect();
			throw err;
		}
	}
	
	// Configures our local media streams and peer connection settings
	async _setup()
	{
		try
		{
			// Create the "local" end of our peer connection and wire up its ICE candidate event handler
			this._localConnection = new RTCPeerConnection();
			this._localConnection.addEventListener('icecandidate', async (event) =>
			{
				if (event.candidate !== null && this._remoteConnection !== null)
				{
					console.log('[Local Connection] ICE candidate: ', event.candidate);
					await this._remoteConnection.addIceCandidate(event.candidate);
				}
			});
			
			// Create the "remote" end of our peer connection and wire up its ICE candidate event handler
			this._remoteConnection = new RTCPeerConnection();
			this._remoteConnection.addEventListener('icecandidate', async (event) =>
			{
				if (event.candidate !== null && this._localConnection !== null)
				{
					console.log('[Remote Connection] ICE candidate: ', event.candidate);
					await this._localConnection.addIceCandidate(event.candidate);
				}
			});
			
			// When a new data channel is created by the "local" peer, configure the "remote" end of the channel
			this._remoteConnection.addEventListener('datachannel', (event) =>
			{
				// Debug output
				console.log('[Remote Connection] New data channel: ', event);
				
				// Retrieve the remote end of the channel
				let remoteChannel = event.channel;
				remoteChannel.binaryType = 'arraybuffer';
				
				// Store the remote end of the channel alongside the local end
				let index = this._channelIndex(remoteChannel);
				this._dataChannels[index]['remote'] = remoteChannel;
				
				// Fire an event when data is received on the remote end of the channel, and echo all messages back to the sender
				remoteChannel.addEventListener('message', (event) =>
				{
					console.log(`[Remote Connection] Received message: ${event.data}`);
					this._events.dispatchEvent(new Event(`data-received-remote-${index}`));
					remoteChannel.send(event.data);
				});
				
				// Keep track of whether the data channel is currently open
				remoteChannel.addEventListener('close', () =>
				{
					console.log(`[Remote Connection] Data channel ${index} closed!`);
					this._dataChannels[index]['connected'] = false;
					this._events.dispatchEvent(new Event(`channel-closed-remote-${index}`));
				});
				
				// Fire an event signalling that the remote end of the channel is open and configured
				this._events.dispatchEvent(new Event(`channel-open-remote-${index}`));
			});
			
			// When a new media stream is received by the "remote" peer, display it in an output <video> element
			this._remoteConnection.addEventListener('track', (event) =>
			{
				// Debug output
				console.log('[Remote Connection] New media track:', event);
				
				// Determine if we need to create a new <video> element
				let numElems = this._remoteVideoElems.length;
				let lastElem = (numElems > 0) ? this._remoteVideoElems[numElems - 1] : null;
				if (lastElem == null || lastElem.srcObject !== event.streams[0])
				{
					// Create a new <video> element and add it to our list
					let newElem = this._createVideoElem(this._containerRemote);
					this._remoteVideoElems.push(newElem);
					
					// Play the new stream with the <video> element
					newElem.srcObject = event.streams[0];
					newElem.play();
				}
			});
			
			// Destroy any output <video> elements generated during previous test runs
			this._containerLocal.empty();
			this._containerRemote.empty();
			
			// Create a regular expression for extracting the file extension from a URL
			// (Do this once prior to the loop below for performance reasons)
			let extRegex = new RegExp('.+\\.([A-Za-z0-9]+)');
			
			// Generate <video> elements to provide the media streams for our "local" peer
			for (let i = 0; i < this._numMediaStreams; ++i)
			{
				// Create the <video> element and point it to our local media stream
				// (Ensure we make the URLs unique to prevent duplicate stream IDs)
				let newElem = this._createVideoElem(this._containerLocal)
				this._localVideoElems.push(newElem);
				for (let url of this._localVideoURLs)
				{
					let matches = extRegex.exec(url);
					let extension = (matches !== null && matches.length > 0) ? matches[1] : 'unknown';
					let source = $(document.createElement('source'));
					source.attr('src', `${url}?i=${i}`);
					source.attr('type', `video/${extension}`);
					$(newElem).append(source);
				}
				
				// Wait for the <video> element to be ready
				if (newElem.readyState < 3) {
					await PromiseUtils.waitForEvent(newElem, 'canplay');
				}
				
				// Attempt to retrieve the media stream from the <video> element
				this._mediaStreams.push(this._getMediaStream(newElem));
			}
			
			// Add each video and audio track from the local media streams to our WebRTC peer connection
			for (let stream of this._mediaStreams)
			{
				for (let track of stream.getTracks())
				{
					console.log('[Local Connection] Add track: ', track);
					this._localConnection.addTrack(track, stream);
				}
			}
			
			// Store the duration of our first local media stream
			if (this._localVideoElems.length > 0) {
				this._mediaDuration = this._localVideoElems[0].duration;
			}
		}
		catch (err)
		{
			// Propagate any errors
			console.log('Propagating error: ', err);
			throw err;
		}
	}
	
	// Establishes the WebRTC peer connection with our loopback peer
	async _connect()
	{
		try
		{
			// Our common offer options
			const offerOptions = {
				offerToReceiveAudio: 1,
				offerToReceiveVideo: 1
			}
			
			// Creates our "local" offer
			const initLocalOffer = async () =>
			{
				const localOffer = await this._localConnection.createOffer(offerOptions);
				console.log(`[Local Connection] Sending offer: ${JSON.stringify(localOffer)}`);
				const localDesc = this._localConnection.setLocalDescription(localOffer);
				const remoteDesc = this._remoteConnection.setRemoteDescription(localOffer);
				return Promise.all([localDesc, remoteDesc]);
			};
			
			// Creates our "remote" answer to the "local" offer
			const initRemoteAnswer = async () =>
			{
				const remoteAnswer = await this._remoteConnection.createAnswer();
				console.log(`[Remote Connection] Answering offer: ${JSON.stringify(remoteAnswer)}`);
				const localDesc = this._remoteConnection.setLocalDescription(remoteAnswer);
				const remoteDesc = this._localConnection.setRemoteDescription(remoteAnswer);
				return Promise.all([localDesc, remoteDesc]);
			};
			
			// Exchange offers and responses
			await initLocalOffer();
			await initRemoteAnswer();
		}
		catch (err)
		{
			// Propagate any errors
			console.log('Propagating error: ', err);
			throw err;
		}
	}
	
	// Closes the WebRTC peer connection with our loopback peer if it has already been established
	_disconnect()
	{
		if (this._localConnection !== null && this._remoteConnection !== null)
		{
			this._localConnection.close();
			this._remoteConnection.close();
		}
	}
	
	// Creates a <video> element for displaying media streams and adds it to the specified container element
	_createVideoElem(container)
	{
		let newElem = $(document.createElement('video')).attr('playsinline', '').attr('muted', '')[0];
		container.append(newElem);
		return newElem;
	}
	
	// Attempts to retrieve the media stream from a <video> element so it can be transmitted over our WebRTC peer connection
	_getMediaStream(videoElem)
	{
		if (videoElem.captureStream) {
			return videoElem.captureStream();
		}
		else if (videoElem.mozCaptureStream) {
			return videoElem.mozCaptureStream();
		}
		else {
			throw new Error('Stream capture is not supported!');
		}
	}
	
	// Creates a data channel for bi-directional messaging between the two ends of our peer WebRTC connection
	_createDataChannel()
	{
		// Create a descriptor object to track the state of our new data channel and add it to our list of channel descriptors
		let channelIndex = this._dataChannels.length;
		this._dataChannels.push({
			'local': null,
			'remote': null,
			'connected': false
		})
		
		// Create the local end of the new data channel
		let localChannel = this._localConnection.createDataChannel(channelIndex.toString(10), {ordered: true});
		localChannel.binaryType = 'arraybuffer';
		this._dataChannels[channelIndex]['local'] = localChannel;
		
		// Fire an event when data is received on the local end of the channel
		localChannel.addEventListener('message', (event) =>
		{
			console.log(`[Local Connection] Received message: ${event.data}`);
			this._events.dispatchEvent(new Event(`data-received-local-${channelIndex}`));
		});
		
		// Keep track of whether the data channel is currently open
		localChannel.addEventListener('open', () =>
		{
			console.log(`[Local Connection] Data channel ${channelIndex} open!`);
			this._dataChannels[channelIndex]['connected'] = true;
			this._events.dispatchEvent(new Event(`channel-open-local-${channelIndex}`));
		});
		localChannel.addEventListener('close', () =>
		{
			console.log(`[Local Connection] Data channel ${channelIndex} closed!`);
			this._dataChannels[channelIndex]['connected'] = false;
			this._events.dispatchEvent(new Event(`channel-closed-local-${channelIndex}`));
		});
	}
	
	// Retrieves the channel index for the supplied WebRTC data channel
	_channelIndex(channel) {
		return parseInt(channel.label)
	}
}


$(document).ready(() =>
{
	// Attempt to retrieve our session ID from the server
	let sessionID = null;
	$.ajax({type: 'GET', url: '/session', dataType: 'text'}).then((data) => {
		sessionID = data;
	});
	
	// Logs status messages to the console, the page, and the server
	let videoContainer = $('#video-container');
	let statusContainer = $('#status-container');
	let statusList = $('#status-messages');
	function logStatus(message, append, emphasis, prefix)
	{
		// Set sensible defaults for our parameters if not specified
		let a = (append !== undefined) ? append : false;
		let e = (emphasis !== undefined) ? emphasis : false;
		let p = (prefix !== undefined) ? prefix : '[Test Suite] ';
		
		// Log the message to the console
		console.log(`${p}${message}`);
		
		// Log the message to the server if we have a session ID
		if (sessionID !== null)
		{
			$.ajax({
				async: false,
				type: 'POST',
				url: '/log',
				contentType: 'application/json; charset=utf-8',
				data: JSON.stringify({
					'session': sessionID,
					'message': (a === true) ? message : `\n${message}`
				})
			});
		}
		
		// Determine if we are adding a new status list item or appending to the last one
		let existingItems = statusList.children();
		if (existingItems.length > 0 && a === true)
		{
			let item = $(existingItems[existingItems.length - 1]);
			item.text(`${item.text()} ${message}`);
		}
		else
		{
			let item = $(document.createElement('li')).text(`${message}`);
			statusList.append(item);
			if (e === true) {
				item.html(`<strong>${item.html()}</strong>`);
			}
		}
	}
	
	// Hide both the video container and status container when the page loads
	statusContainer.hide();
	videoContainer.hide();
	
	// Wire up the run button to trigger the test suite
	let runButton = $('#run-button');
	runButton[0].addEventListener(
		'click', async () =>
		{
			// The common settings which remain the same across all tests
			const videoLocal = $('#video-local');
			const videoRemote = $('#video-remote');
			
			// The sequence of values we use to test each parameter, following powers of two paired with -1 and +1 offsets to test boundary conditions
			const paramSequence = [
				1,
				2,
				3, 4, 5,
				7, 8, 9,
				15, 16, 17,
				31, 32, 33,
				47, 48, 49, 50, 51, 52, 53, 54,  // 64 concurrent WebRTC media streams is one of the common observed breaking points,
				55, 56, 57, 58, 59, 60, 61, 62,  // so these are here to help refine the identified limit to a more accurate value
				63, 64, 65,
				95, 96, 97,                      //
				111, 112, 113,                   // 128 concurrent WebRTC media streams is another common observed breaking point,
				119, 120, 121,                   // so these are here to help refine the identified limit to a more accurate value
				122, 123, 124, 125, 126,         //
				127, 128, 129,
				255, 256, 257,
				511, 512, 513,
				1023, 1024, 1025,
				2047, 2048, 2049,
				4095, 4096, 4097,
				8191, 8192, 8193,
				16383, 16384, 16385,
				32767, 32768, 32769,
				65535 // Note that 65535 is the theoretical maximum limit for WebRTC data channels, since 65536 is a reserved ID that cannot be used
			];
			
			// Determine if we are attempting to force the use of a specific video codec or using the browser's first supported codec
			const h264Video = './video.mp4';
			const vp9Video = './video.webm';
			let videoURLs = [];
			if ($('#codec-h264').is(':checked')) {
				videoURLs = [h264Video];
			}
			else if ($('#codec-vp9').is(':checked')) {
				videoURLs = [vp9Video];
			}
			else {
				videoURLs = [h264Video, vp9Video];
			}
			
			// The parameters we test
			let params = {
				
				'dataChannels': {
					
					// The human-readable description of the parameter, in plural form
					'description': {
						'singular': 'data channel',
						'plural': 'data channels'
					},
					
					// The lambda function to return a test run for testing this parameter in isolation
					'isolation': (v) => new WebRtcLimitTestRun(videoLocal, videoRemote, videoURLs, 1, v),
					
					// This will be populated with the maximum value for this parameter supported by the current web browser
					'maximum': 0
				},
				
				'mediaStreams': {
					
					// The human-readable description of the parameter, in plural form
					'description': {
						'singular': 'media stream',
						'plural': 'media streams'
					},
					
					// The lambda function to return a test run for testing this parameter in isolation
					'isolation': (v) => new WebRtcLimitTestRun(videoLocal, videoRemote, videoURLs, v, 1),
					
					// This will be populated with the maximum value for this parameter supported by the current web browser
					'maximum': 0
				}
				
			};
			
			// Hide the controls and show both the status container and video element container
			$('#controls').hide();
			statusContainer.show();
			videoContainer.show();
			
			// Test each of our parameters in isolation to determine the limit for the current browser
			for (let param of Object.keys(params))
			{
				// Log output
				let details = params[param];
				logStatus(`Determining the maximum supported number of ${details['description']['plural']}...`, false, true);
				
				// Test increasing values for the parameter in isolation until we determine the maximum
				for (let value of paramSequence)
				{
					try
					{
						let singularOrPlural = (value > 1) ? details['description']['plural'] : details['description']['singular'];
						logStatus(`Testing ${value} ${singularOrPlural}...`);
						let test = details['isolation'](value);
						let start = window.performance.now();
						await test.run();
						params[param]['maximum'] = value;
						let end = window.performance.now();
						let duration = (end - start) / 1000.0;
						let overhead = duration - test.getMediaDuration();
						logStatus(`Test succeeded in ${duration.toFixed(2)} seconds (video duration ${test.getMediaDuration().toFixed(2)} seconds, test run overhead ${overhead.toFixed(2)} seconds)`, true);
					}
					catch (err)
					{
						logStatus(`Test failed! ${err}`, true);
						break;
					}
				}
				
				// Report the identified maximum value for the current parameter
				logStatus(`Identified maximum for ${details['description']['plural']}: ${details['maximum']}`, false, true);
			}
		},
		false
	);
});
