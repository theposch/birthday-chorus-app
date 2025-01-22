class BirthdayChorus {
    constructor() {
        this.mediaRecorder = null;
        this.mediaStream = null;
        this.mediaChunks = [];
        this.recordings = [];
        this.isRecording = false;
        this.currentCameraIndex = 0;
        this.gridVideos = [];
        this.cameras = [];
        this.microphones = [];
        this.players = []; // Store Plyr instances

        // UI Elements
        this.recordButton = document.getElementById('recordButton');
        this.saveButton = document.getElementById('saveButton');
        this.playChorusButton = document.getElementById('playChorusButton');
        this.downloadChorusButton = document.getElementById('downloadChorusButton');
        this.switchCameraButton = document.getElementById('switchCamera');
        this.recordingStatus = document.getElementById('recordingStatus');
        this.previewVideo = document.getElementById('previewVideo');
        this.recordingPreview = document.getElementById('recordingPreview');
        this.recordingsList = document.getElementById('recordingsList');
        this.recordingOverlay = document.getElementById('recordingOverlay');
        this.chorusGridView = document.getElementById('chorusGridView');
        this.cameraSelect = document.getElementById('cameraSelect');
        this.microphoneSelect = document.getElementById('microphoneSelect');

        // Additional UI elements
        this.deviceError = document.getElementById('deviceError');
        this.permissionPrompt = document.getElementById('permissionPrompt');

        // Initialize debug info
        this.debugInfo = document.createElement('div');
        this.debugInfo.className = 'debug-info';
        document.body.appendChild(this.debugInfo);
        this.updateDebugInfo('App initialized');

        // Set up event listeners
        this.initializeEventListeners();

        // Add synchronization properties
        this.playbackStartTime = null;
        this.syncInterval = null;
        this.videoStates = new Map(); // Track video states

        // Add metronome properties
        this.metronomeCanvas = document.getElementById('metronomeCanvas');
        this.metronomeCtx = this.metronomeCanvas?.getContext('2d');
        this.metronomeBPM = 120; // Standard tempo for Happy Birthday
        this.metronomeInterval = null;
        this.countdownOverlay = document.getElementById('countdownOverlay');

        // Add audio visualization properties
        this.audioContext = null;
        this.analyser = null;
        this.waveformCanvas = document.getElementById('waveformCanvas');
        this.waveformCtx = this.waveformCanvas?.getContext('2d');
        this.visualizationRequestId = null;

        // Initialize the app
        this.init();
    }

    async init() {
        try {
            await this.checkPermissions();
            await this.initializeDevices();
        } catch (err) {
            this.handleDeviceError(err);
        }
    }

    async checkPermissions() {
        try {
            const permissions = await Promise.all([
                navigator.permissions.query({ name: 'camera' }),
                navigator.permissions.query({ name: 'microphone' })
            ]);

            const [camera, microphone] = permissions;
            
            if (camera.state === 'prompt' || microphone.state === 'prompt') {
                this.showPermissionPrompt(true);
            } else {
                this.showPermissionPrompt(false);
            }

            // Listen for permission changes
            camera.addEventListener('change', () => this.handlePermissionChange());
            microphone.addEventListener('change', () => this.handlePermissionChange());

            return permissions.every(p => p.state === 'granted');
        } catch (err) {
            console.warn('Permissions API not supported:', err);
            return true; // Proceed with device initialization
        }
    }

    handlePermissionChange() {
        this.checkPermissions().then(granted => {
            if (granted) {
                this.showPermissionPrompt(false);
                this.showDeviceError(false);
                this.initializeDevices();
            }
        });
    }

    showLoading(element, isLoading) {
        if (isLoading) {
            element.classList.add('loading');
            if (element.tagName === 'BUTTON') {
                element.disabled = true;
            }
        } else {
            element.classList.remove('loading');
            if (element.tagName === 'BUTTON') {
                element.disabled = false;
            }
        }
    }

    showDeviceError(show, message = null) {
        if (show) {
            this.deviceError.textContent = message || this.deviceError.textContent;
            this.deviceError.classList.add('visible');
        } else {
            this.deviceError.classList.remove('visible');
        }
    }

    showPermissionPrompt(show) {
        if (show) {
            this.permissionPrompt.classList.add('visible');
        } else {
            this.permissionPrompt.classList.remove('visible');
        }
    }

    initializeEventListeners() {
        this.recordButton.addEventListener('click', async () => {
            if (!this.mediaStream) {
                this.recordButton.disabled = true;
                this.recordButton.textContent = 'Requesting Permission...';
                try {
                    await this.initializeCamera();
                    this.recordButton.textContent = 'Start Recording';
                } catch (err) {
                    this.recordButton.textContent = 'Camera Access Denied';
                }
                this.recordButton.disabled = false;
            } else {
                this.toggleRecording();
            }
        });
        this.saveButton.addEventListener('click', () => this.saveRecording());
        this.playChorusButton.addEventListener('click', () => this.playChorus());
        this.downloadChorusButton.addEventListener('click', () => this.downloadChorus());
        this.switchCameraButton.addEventListener('click', () => this.switchCamera());
    }

    async initializeDevices() {
        this.showLoading(this.recordButton, true);
        this.showDeviceError(false);
        
        try {
            // First request permissions
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            stream.getTracks().forEach(track => track.stop()); // Stop the stream as we just needed permissions

            // Get the list of devices
            const devices = await navigator.mediaDevices.enumerateDevices();
            
            // Filter and store devices
            this.cameras = devices.filter(device => device.kind === 'videoinput');
            this.microphones = devices.filter(device => device.kind === 'audioinput');

            // Update UI to show loading state
            this.cameraSelect.disabled = true;
            this.microphoneSelect.disabled = true;
            this.recordButton.disabled = true;
            this.updateDebugInfo('Loading devices...');

            // Populate camera select
            this.cameraSelect.innerHTML = this.cameras.map(device => 
                `<option value="${device.deviceId}">${device.label || `Camera ${this.cameras.indexOf(device) + 1}`}</option>`
            ).join('');

            // Populate microphone select
            this.microphoneSelect.innerHTML = this.microphones.map(device => 
                `<option value="${device.deviceId}">${device.label || `Microphone ${this.microphones.indexOf(device) + 1}`}</option>`
            ).join('');

            // Enable controls
            this.cameraSelect.disabled = false;
            this.microphoneSelect.disabled = false;
            this.recordButton.disabled = false;
            this.switchCameraButton.disabled = this.cameras.length <= 1;

            // Add event listeners for device selection if not already added
            if (!this._deviceListenersInitialized) {
                this.cameraSelect.addEventListener('change', () => this.updateMediaStream());
                this.microphoneSelect.addEventListener('change', () => this.updateMediaStream());
                this._deviceListenersInitialized = true;
            }

            // Initialize stream with first available devices
            await this.updateMediaStream();
            this.updateDebugInfo(`Found ${this.cameras.length} cameras and ${this.microphones.length} microphones`);

            this.showLoading(this.recordButton, false);
            this.recordButton.textContent = 'Start Recording';
        } catch (err) {
            this.showLoading(this.recordButton, false);
            console.error('Error initializing devices:', err);
            this.updateDebugInfo('Failed to initialize devices. Please check permissions.');
            this.handleDeviceError(err);
        }
    }

    handleDeviceError(error) {
        let message = 'An error occurred while accessing your devices. ';
        
        switch (error.name) {
            case 'NotAllowedError':
                message += 'Please allow camera and microphone access in your browser settings.';
                this.showPermissionPrompt(true);
                break;
            case 'NotFoundError':
                message += 'No camera or microphone found. Please connect a device and try again.';
                break;
            case 'NotReadableError':
                message += 'Your camera or microphone is already in use by another application.';
                break;
            case 'OverconstrainedError':
                message += 'The requested device settings are not supported.';
                break;
            default:
                message += error.message || 'Please check your device connections and try again.';
        }

        this.showDeviceError(true, message);
        this.recordButton.disabled = true;
        this.recordButton.textContent = 'Device Error';
    }

    async updateMediaStream() {
        if (this.isRecording) {
            alert('Please stop recording before switching devices');
            return;
        }

        this.showLoading(this.recordButton, true);
        try {
            // Stop any existing stream
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
            }

            // Get selected devices
            const videoDeviceId = this.cameraSelect.value;
            const audioDeviceId = this.microphoneSelect.value;

            // Request new stream with selected devices
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: {
                    deviceId: audioDeviceId ? { exact: audioDeviceId } : undefined,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Update preview
            await this.startVideoPreview();
            this.updateDebugInfo('Media stream updated with selected devices');

            this.showLoading(this.recordButton, false);
        } catch (err) {
            this.showLoading(this.recordButton, false);
            console.error('Error updating media stream:', err);
            this.updateDebugInfo(`Failed to update media stream: ${err.message}`);
            alert('Failed to switch devices. Please try again.');
            this.handleDeviceError(err);
        }
    }

    async initializeCamera() {
        try {
            await this.updateMediaStream();
            return true;
        } catch (err) {
            console.error('Error initializing camera:', err);
            throw err;
        }
    }

    async startVideoPreview() {
        if (!this.mediaStream) {
            this.updateDebugInfo('No media stream available for preview');
            return;
        }

        try {
            // If switching cameras, stop all tracks first
            if (this.previewVideo.srcObject) {
                const tracks = this.previewVideo.srcObject.getTracks();
                tracks.forEach(track => track.stop());
            }

            // Set the new stream and start playing
            this.previewVideo.srcObject = this.mediaStream;
            await this.previewVideo.play();
            
            // Enable/disable camera switching based on available cameras
            this.switchCameraButton.disabled = this.cameras.length <= 1;
            
            // Update debug info with active tracks
            const videoTrack = this.mediaStream.getVideoTracks()[0];
            const audioTrack = this.mediaStream.getAudioTracks()[0];
            this.updateDebugInfo(`Preview started - Video: ${videoTrack?.label || 'none'}, Audio: ${audioTrack?.label || 'none'}`);
        } catch (err) {
            console.error('Error starting video preview:', err);
            this.updateDebugInfo(`Preview error: ${err.message}`);
            alert('Unable to start video preview. Please check your camera permissions and refresh the page.');
        }
    }

    async switchCamera() {
        if (this.isRecording || !this.cameras || this.cameras.length <= 1) {
            return;
        }

        try {
            this.currentCameraIndex = (this.currentCameraIndex + 1) % this.cameras.length;
            this.cameraSelect.value = this.cameras[this.currentCameraIndex].deviceId;
            await this.updateMediaStream();
            this.updateDebugInfo(`Switched to camera: ${this.cameras[this.currentCameraIndex].label}`);
        } catch (err) {
            console.error('Error switching camera:', err);
            this.updateDebugInfo(`Camera switch error: ${err.message}`);
            this.handleDeviceError(err);
        }
    }

    async startCountdown() {
        if (!this.countdownOverlay) {
            this.countdownOverlay = document.createElement('div');
            this.countdownOverlay.className = 'countdown-overlay';
            document.body.appendChild(this.countdownOverlay);
        }

        this.recordButton.disabled = true;
        
        // Start metronome
        this.startMetronome();
        
        // Visual countdown with beats
        for (let i = 4; i > 0; i--) {
            this.countdownOverlay.innerHTML = `
                <div class="countdown-content">
                    <div class="countdown-number">${i}</div>
                    <div class="countdown-text">Get ready to sing!</div>
                </div>
            `;
            this.countdownOverlay.style.display = 'flex';
            await new Promise(resolve => setTimeout(resolve, 60000 / this.metronomeBPM));
        }

        // Show "GO!" for one beat
        this.countdownOverlay.innerHTML = `
            <div class="countdown-content">
                <div class="countdown-number">🎵</div>
                <div class="countdown-text">Sing!</div>
            </div>
        `;
        
        await new Promise(resolve => setTimeout(resolve, 60000 / this.metronomeBPM));
        this.countdownOverlay.style.display = 'none';
        this.recordButton.disabled = false;
    }

    startMetronome() {
        if (!this.metronomeCanvas || !this.metronomeCtx) return;

        const ctx = this.metronomeCtx;
        const canvas = this.metronomeCanvas;
        let beat = 0;
        const beatsPerMeasure = 4;

        // Clear any existing interval
        if (this.metronomeInterval) {
            clearInterval(this.metronomeInterval);
        }

        // Set up canvas
        canvas.width = 200;
        canvas.height = 50;

        const drawMetronome = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw beat indicators
            const spacing = canvas.width / beatsPerMeasure;
            for (let i = 0; i < beatsPerMeasure; i++) {
                ctx.beginPath();
                ctx.arc(spacing * (i + 0.5), canvas.height / 2, 10, 0, Math.PI * 2);
                ctx.fillStyle = i === beat ? '#ff4444' : '#dddddd';
                ctx.fill();
            }

            // Update beat
            beat = (beat + 1) % beatsPerMeasure;
        };

        // Start metronome
        this.metronomeInterval = setInterval(drawMetronome, 60000 / this.metronomeBPM);
        drawMetronome(); // Initial draw
    }

    stopMetronome() {
        if (this.metronomeInterval) {
            clearInterval(this.metronomeInterval);
            this.metronomeInterval = null;
        }

        // Clear canvas
        if (this.metronomeCtx && this.metronomeCanvas) {
            this.metronomeCtx.clearRect(0, 0, this.metronomeCanvas.width, this.metronomeCanvas.height);
        }
    }

    async toggleRecording() {
        if (!this.isRecording) {
            await this.startCountdown();
            this.startRecording();
        } else {
            this.stopRecording();
        }
    }

    async startRecording() {
        this.mediaChunks = [];
        
        // Check supported MIME types
        const mimeTypes = [
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp8,aac',
            'video/webm',
            'video/mp4'
        ];
        
        let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
        if (!selectedMimeType) {
            this.updateDebugInfo('No supported video MIME types found');
            alert('Your browser does not support video recording');
            return;
        }

        this.updateDebugInfo(`Using MIME type: ${selectedMimeType}`);
        
        try {
            // Start metronome and visualization
            this.startMetronome();
            await this.initializeAudioVisualization();

            this.mediaRecorder = new MediaRecorder(this.mediaStream, {
                mimeType: selectedMimeType,
                audioBitsPerSecond: 128000,
                videoBitsPerSecond: 2500000
            });

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.mediaChunks.push(event.data);
                }
            };

            this.mediaRecorder.onerror = (error) => {
                console.error('MediaRecorder error:', error);
                this.stopRecording();
                alert('Recording error occurred. Please try again.');
            };

            this.mediaRecorder.onstop = () => {
                if (this.mediaChunks.length === 0) {
                    console.error('No media data recorded');
                    alert('No media data was recorded. Please try again.');
                    return;
                }

                const mediaBlob = new Blob(this.mediaChunks, { type: selectedMimeType });
                const url = URL.createObjectURL(mediaBlob);
                this.recordingPreview.src = url;
                this.saveButton.disabled = false;
            };

            // Start recording
            this.mediaRecorder.start(1000);
            this.isRecording = true;
            this.recordButton.textContent = 'Stop Recording';
            this.recordingOverlay.classList.add('recording');
            this.recordingStatus.textContent = 'Recording in progress...';
            
            // Add a safety timeout of 2 minutes
            this.recordingTimeout = setTimeout(() => {
                if (this.isRecording) {
                    this.stopRecording();
                    alert('Recording stopped automatically after 2 minutes');
                }
            }, 120000);

        } catch (error) {
            this.stopMetronome();
            this.stopWaveformVisualization();
            console.error('Error starting recording:', error);
            alert('Failed to start recording. Please check your camera and microphone permissions.');
        }
    }

    stopRecording() {
        if (this.recordingTimeout) {
            clearTimeout(this.recordingTimeout);
        }
        
        // Stop metronome and visualization
        this.stopMetronome();
        this.stopWaveformVisualization();
        
        try {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            this.isRecording = false;
            this.recordButton.textContent = 'Start Recording';
            this.recordingOverlay.classList.remove('recording');
            this.recordingStatus.textContent = 'Recording stopped. Preview below:';
        } catch (error) {
            console.error('Error stopping recording:', error);
            alert('Error stopping recording. Please refresh the page and try again.');
        }
    }

    saveRecording() {
        const name = prompt('Name this recording (optional):', `Recording ${this.recordings.length + 1}`);
        if (!name) return;

        try {
            const mediaBlob = new Blob(this.mediaChunks, { type: 'video/webm' });
            const recording = { blob: mediaBlob, name };
            this.recordings.push(recording);
            this.addRecordingToList(mediaBlob, name);
            this.addToGridView(mediaBlob);
            this.saveButton.disabled = true;
            this.recordingPreview.src = '';
            
            console.log('Recording saved successfully:', name);
        } catch (error) {
            console.error('Error saving recording:', error);
            alert('Failed to save recording. Please try again.');
        }
    }

    updateGridLayout() {
        if (this.gridVideos.length === 0) {
            this.chorusGridView.innerHTML = '<div class="empty-grid">No recordings yet</div>';
            return;
        }

        const count = this.gridVideos.length;
        const cols = Math.ceil(Math.sqrt(count));
        
        // Clear existing grid
        this.chorusGridView.innerHTML = '';
        
        // Set up grid layout
        this.chorusGridView.style.display = 'grid';
        this.chorusGridView.style.gap = '10px';
        this.chorusGridView.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        
        // Re-add all videos to the grid
        this.gridVideos.forEach((video, index) => {
            const container = document.createElement('div');
            container.className = 'grid-video-container';
            container.style.position = 'relative';
            container.style.width = '100%';
            container.style.paddingBottom = '56.25%'; // 16:9 aspect ratio
            
            // Style the video element
            video.style.position = 'absolute';
            video.style.top = '0';
            video.style.left = '0';
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            
            container.appendChild(video);
            this.chorusGridView.appendChild(container);
        });
    }

    addToGridView(blob) {
        try {
            const videoElement = document.createElement('video');
            videoElement.src = URL.createObjectURL(blob);
            videoElement.controls = false;
            videoElement.muted = true;
            videoElement.playsInline = true;
            videoElement.preload = 'auto';
            videoElement.className = 'plyr-video';
            videoElement.style.display = 'block'; // Ensure video is visible
            
            // Add error handling
            videoElement.onerror = (error) => {
                console.error('Video error:', error);
                this.updateDebugInfo(`Video error: ${videoElement.error.message}`);
            };
            
            // Add to grid videos array
            this.gridVideos.push(videoElement);
            
            // Update grid layout
            this.updateGridLayout();
            
            // Initialize Plyr
            const player = new Plyr(videoElement, {
                controls: ['play', 'progress', 'current-time', 'mute', 'volume'],
                hideControls: true,
                clickToPlay: false,
                keyboard: { focused: false, global: false }
            });
            this.players.push(player);
            
            // Ensure video is loaded
            videoElement.load();
            
            // Add loading feedback
            this.updateDebugInfo(`Added video to grid (${this.gridVideos.length} total)`);
        } catch (error) {
            console.error('Error adding to grid view:', error);
            this.updateDebugInfo(`Grid view error: ${error.message}`);
        }
    }

    cleanupVideoResources(video) {
        try {
            // Destroy Plyr instance if it exists
            const playerIndex = this.gridVideos.indexOf(video);
            if (playerIndex !== -1 && this.players[playerIndex]) {
                this.players[playerIndex].destroy();
                this.players.splice(playerIndex, 1);
            }

            if (video.src) {
                URL.revokeObjectURL(video.src);
            }
            video.removeAttribute('src');
            video.load(); // Force browser to release resources
        } catch (error) {
            console.error('Error cleaning up video resources:', error);
        }
    }

    async playChorus() {
        if (this.gridVideos.length === 0) {
            alert('No recordings available to play');
            return;
        }

        this.showLoading(this.playChorusButton, true);
        this.playChorusButton.textContent = 'Preparing...';

        try {
            // Stop any existing playback
            this.stopChorus();
            
            // Reset all videos first
            for (const video of this.gridVideos) {
                video.muted = false; // Enable sound for playback
                video.currentTime = 0;
                video.style.display = 'block'; // Ensure video is visible
                video.style.opacity = '1';
                video.load(); // Force reload
            }

            // Update grid layout to ensure proper positioning
            this.updateGridLayout();

            // Wait for all videos to be ready
            await Promise.all(this.gridVideos.map(video => 
                new Promise((resolve, reject) => {
                    const loadHandler = () => {
                        video.removeEventListener('canplaythrough', loadHandler);
                        video.removeEventListener('error', errorHandler);
                        resolve();
                    };
                    
                    const errorHandler = (error) => {
                        video.removeEventListener('canplaythrough', loadHandler);
                        video.removeEventListener('error', errorHandler);
                        reject(new Error(`Video loading failed: ${error.message}`));
                    };

                    if (video.readyState >= 3) {
                        resolve();
                    } else {
                        video.addEventListener('canplaythrough', loadHandler);
                        video.addEventListener('error', errorHandler);
                    }
                }).catch(error => {
                    console.error('Video load error:', error);
                    throw error;
                })
            ));

            // Start all videos playing
            const playPromises = this.gridVideos.map(video => {
                try {
                    // Ensure video is visible before playing
                    video.style.display = 'block';
                    video.style.visibility = 'visible';
                    return video.play().catch(error => {
                        console.error('Play error:', error);
                        throw error;
                    });
                } catch (error) {
                    console.error('Play setup error:', error);
                    throw error;
                }
            });

            await Promise.all(playPromises);
            this.playChorusButton.textContent = 'Playing Chorus...';

            // Start monitoring playback
            this.startPlaybackMonitoring();

        } catch (error) {
            console.error('Error playing chorus:', error);
            this.updateDebugInfo(`Playback error: ${error.message}`);
            this.stopChorus();
            alert('Failed to play chorus. Please try again.');
        } finally {
            this.showLoading(this.playChorusButton, false);
        }
    }

    startPlaybackMonitoring() {
        if (this.playbackMonitor) {
            cancelAnimationFrame(this.playbackMonitor);
            this.playbackMonitor = null;
        }

        const monitorFrame = () => {
            try {
                // Get currently playing videos
                const playingVideos = this.gridVideos.filter(v => !v.paused && !v.ended);
                
                if (playingVideos.length === 0) {
                    this.stopChorus();
                    return;
                }

                // Calculate average time
                const times = playingVideos.map(v => v.currentTime);
                const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

                // Sync videos that are too far from average
                playingVideos.forEach(video => {
                    const drift = Math.abs(video.currentTime - avgTime);
                    if (drift > 0.1) { // More than 100ms drift
                        try {
                            video.currentTime = avgTime;
                        } catch (error) {
                            console.error('Sync adjustment failed:', error);
                        }
                    }
                });

                // Update debug info
                const maxDrift = Math.max(...times.map(t => Math.abs(t - avgTime)));
                this.updateDebugInfo(`Playing: ${playingVideos.length} videos, Max drift: ${maxDrift.toFixed(3)}s`);

                // Schedule next frame
                this.playbackMonitor = requestAnimationFrame(monitorFrame);
            } catch (error) {
                console.error('Monitoring error:', error);
                this.stopChorus();
            }
        };

        // Start the monitoring loop
        this.playbackMonitor = requestAnimationFrame(monitorFrame);
    }

    stopChorus() {
        // Clear monitoring
        if (this.playbackMonitor) {
            cancelAnimationFrame(this.playbackMonitor);
            this.playbackMonitor = null;
        }

        // Stop all videos
        this.gridVideos.forEach(video => {
            try {
                video.pause();
                video.currentTime = 0;
                video.muted = true;
                // Don't hide videos, just mute them
                video.style.opacity = '0.7'; // Dim videos when not playing
            } catch (error) {
                console.error('Error stopping video:', error);
            }
        });

        // Reset UI
        this.playChorusButton.textContent = 'Play Chorus';
        this.showLoading(this.playChorusButton, false);
    }

    addRecordingToList(blob, name) {
        const recordingItem = document.createElement('div');
        recordingItem.className = 'recording-item';
        
        const nameLabel = document.createElement('div');
        nameLabel.className = 'recording-name';
        nameLabel.textContent = name || `Recording ${this.recordings.length}`;
        
        const video = document.createElement('video');
        video.controls = true;
        video.src = URL.createObjectURL(blob);
        video.preload = 'auto';
        
        const controls = document.createElement('div');
        controls.className = 'recording-controls';
        
        const deleteButton = document.createElement('button');
        deleteButton.textContent = '🗑️ Delete';
        deleteButton.className = 'btn';
        deleteButton.onclick = () => {
            const index = Array.from(this.recordingsList.children).indexOf(recordingItem);
            if (index !== -1) {
                // Clean up resources
                this.cleanupVideoResources(video);
                if (this.gridVideos[index]) {
                    this.cleanupVideoResources(this.gridVideos[index]);
                }
                
                // Remove from arrays and DOM
                this.recordings.splice(index, 1);
                if (this.gridVideos[index]) {
                    this.gridVideos[index].remove();
                    this.gridVideos.splice(index, 1);
                }
                recordingItem.remove();
                
                this.updateGridLayout();
                this.updateDebugInfo(`Deleted recording: ${name}`);
            }
        };

        controls.appendChild(deleteButton);
        recordingItem.appendChild(nameLabel);
        recordingItem.appendChild(video);
        recordingItem.appendChild(controls);
        this.recordingsList.appendChild(recordingItem);
    }

    async downloadChorus() {
        if (this.recordings.length === 0) {
            alert('No recordings to download!');
            return;
        }

        // Create a zip file containing all recordings
        const zip = new JSZip();
        this.recordings.forEach((recording, index) => {
            const fileName = `${recording.name || 'recording-' + (index + 1)}.webm`;
            zip.file(fileName, recording.blob);
        });

        // Generate and download the zip file
        const content = await zip.generateAsync({type: 'blob'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'birthday-chorus.zip';
        a.click();
    }

    updateDebugInfo(message) {
        console.log(message);
        const permissionState = navigator.permissions ? 'checking...' : 'not available';
        
        this.debugInfo.innerHTML = `
            <div>Status: ${message}</div>
            <div>Recordings: ${this.recordings.length}</div>
            <div>Recording: ${this.isRecording}</div>
            <div>MediaRecorder State: ${this.mediaRecorder?.state || 'not initialized'}</div>
            <div>Camera Count: ${this.cameras?.length || 0}</div>
            <div>Media Stream: ${this.mediaStream ? 'active' : 'not available'}</div>
            <div>Permissions: ${permissionState}</div>
        `;

        // Check and update permission status if available
        if (navigator.permissions) {
            navigator.permissions.query({ name: 'camera' }).then(result => {
                this.debugInfo.innerHTML += `<div>Camera Permission: ${result.state}</div>`;
            });
            navigator.permissions.query({ name: 'microphone' }).then(result => {
                this.debugInfo.innerHTML += `<div>Microphone Permission: ${result.state}</div>`;
            });
        }
    }

    async initializeAudioVisualization() {
        if (!this.mediaStream || !this.waveformCanvas || !this.waveformCtx) return;

        try {
            // Create audio context and analyser
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;

            // Connect media stream to analyser
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);

            // Set up canvas
            this.waveformCanvas.width = this.waveformCanvas.offsetWidth;
            this.waveformCanvas.height = this.waveformCanvas.offsetHeight;

            this.startWaveformVisualization();
        } catch (error) {
            console.error('Error initializing audio visualization:', error);
        }
    }

    startWaveformVisualization() {
        if (!this.analyser || !this.waveformCtx) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const ctx = this.waveformCtx;
        const canvas = this.waveformCanvas;
        const WIDTH = canvas.width;
        const HEIGHT = canvas.height;

        const draw = () => {
            this.visualizationRequestId = requestAnimationFrame(draw);

            this.analyser.getByteTimeDomainData(dataArray);

            ctx.fillStyle = 'rgb(200, 200, 200)';
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgb(0, 0, 0)';
            ctx.beginPath();

            const sliceWidth = WIDTH * 1.0 / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * HEIGHT / 2;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }

                x += sliceWidth;
            }

            ctx.lineTo(canvas.width, canvas.height / 2);
            ctx.stroke();
        };

        draw();
    }

    stopWaveformVisualization() {
        if (this.visualizationRequestId) {
            cancelAnimationFrame(this.visualizationRequestId);
            this.visualizationRequestId = null;
        }

        if (this.waveformCtx && this.waveformCanvas) {
            this.waveformCtx.clearRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
        }

        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
            this.audioContext = null;
            this.analyser = null;
        }
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new BirthdayChorus();
}); 