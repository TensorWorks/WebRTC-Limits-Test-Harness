#!/usr/bin/env python3
from flask import Flask, abort, redirect, request, url_for
from os.path import abspath, dirname, join
from uuid import uuid4
import sys

rootDir = dirname(abspath(__file__))
logsDir = join(rootDir, 'logs')
app = Flask(__name__)


# Appends a log message to the log file for a specific session
def append_log(sessionID, message):
	with open(join(logsDir, '{}.txt'.format(sessionID)), 'ab') as f:
		f.write(message.encode('utf-8'))


# Generates a new session ID for use when submitting log messages
@app.route('/session')
def session():
	
	# Generate a new session ID and log the user agent for the session
	sessionID = uuid4().hex
	append_log(sessionID, '[New session with ID {} and user-agent: "{}"]'.format(
		sessionID,
		request.user_agent
	))
	
	# Send the session ID back to the client
	return sessionID

# Receives log messages and appends them to the log file for the client's session
@app.route('/log', methods=['POST'])
def log():
	
	# Extract the request JSON data
	data = request.get_json()
	sessionID = data.get('session', None)
	message = data.get('message', None)
	
	# Verify that both a session ID and a message were specified
	if sessionID is not None and message is not None:
		append_log(sessionID, message)
		return ''
	else:
		abort(400)

# Redirect the root URL to the index page
@app.route('/')
def index():
	return redirect(url_for('static', filename='index.html'))

# Server over HTTPS on port 4443
if __name__ == '__main__':
	app.run('127.0.0.1', 4443, ssl_context=('cert.pem', 'key.pem'))
