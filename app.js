/* app.js - Main Application Logic */

window.app = {
    state: {
        activeSection: 'dashboard',
        isRecording: false,
        mediaRecorder: null,
        audioChunks: [],
        recordingStartTime: null,
        timerInterval: null,
        currentBlob: null,
        currentDuration: 0,
        audioUrl: null,
        currentUser: null, // Logged in user info
        currentPlayingCallId: null
    },

    init: async () => {
        // --- Seed Initial User ---
        const users = await db.users.toArray();
        let ravishUser = users.find(u => u.name.toLowerCase() === 'ravish');

        if (!ravishUser) {
            console.log("Creating admin user 'Ravish'...");
            await db.users.add({
                name: "Ravish",
                pin: "123",
                role: "admin"
            });
        }

        // --- Data Retention Cleanup (Keep 3 Months) ---
        await app.cleanupOldData();

        // Show Login Modal immediately
        const modal = document.getElementById('login-modal');
        if (modal) {
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
            }, 50);
        }

        // Check for mic permissions
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            console.log('Media Devices Supported');
        } else {
            app.showToast('Media Recorder API not supported in this browser.', 'error');
        }
    },

    cleanupOldData: async () => {
        try {
            const ninetyDaysInMs = 90 * 24 * 60 * 60 * 1000;
            const eightyDaysInMs = 80 * 24 * 60 * 60 * 1000; // Warning threshold
            const now = Date.now();
            const cutoff = now - ninetyDaysInMs;
            const warningCutoff = now - eightyDaysInMs;

            // Check if any data exists between 80-90 days old for warning
            const hasOldCalls = (await db.calls.where('timestamp').between(cutoff, warningCutoff).count()) > 0;
            const hasOldActivities = (await db.activities.where('timestamp').between(cutoff, warningCutoff).count()) > 0;
            const hasOldTickets = (await db.tickets.where('createdAt').between(cutoff, warningCutoff).count()) > 0;

            if (hasOldCalls || hasOldActivities || hasOldTickets) {
                document.getElementById('backup-warning').classList.remove('hidden');
            } else {
                document.getElementById('backup-warning').classList.add('hidden');
            }

            // Delete old calls
            const oldCalls = await db.calls.where('timestamp').below(cutoff).toArray();
            if (oldCalls.length > 0) {
                console.log(`Cleaning up ${oldCalls.length} old call recordings...`);
                await db.calls.bulkDelete(oldCalls.map(c => c.id));
            }

            // Delete old activities/tasks
            const oldActivities = await db.activities.where('timestamp').below(cutoff).toArray();
            if (oldActivities.length > 0) {
                console.log(`Cleaning up ${oldActivities.length} old tasks...`);
                await db.activities.bulkDelete(oldActivities.map(a => a.id));
            }

            // Delete old tickets
            const oldTickets = await db.tickets.where('createdAt').below(cutoff).toArray();
            if (oldTickets.length > 0) {
                console.log(`Cleaning up ${oldTickets.length} old tickets...`);
                await db.tickets.bulkDelete(oldTickets.map(t => t.id));
            }
        } catch (e) {
            console.error("Data cleanup failed:", e);
        }
    },

    backupFullSystem: async () => {
        try {
            const calls = await db.calls.toArray();
            const activities = await db.activities.toArray();
            const tickets = await db.tickets.toArray();

            const backupData = {
                exportedAt: new Date().toISOString(),
                calls,
                activities,
                tickets
            };

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `MISL_Full_Backup_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            app.showToast('Full system backup successful!', 'success');
        } catch (e) {
            console.error("Backup failed:", e);
            app.showToast('Backup failed.', 'error');
        }
    },

    // --- Authentication ---

    login: async () => {
        const usernameInput = document.getElementById('login-username').value.trim();
        const passwordInput = document.getElementById('login-password').value;
        const errorMsg = document.getElementById('login-error');

        if (!usernameInput || !passwordInput) return;

        try {
            // Find user by name (case insensitive) and password (stored in pin field)
            const users = await db.users.toArray();
            const user = users.find(u => u.name.toLowerCase() === usernameInput.toLowerCase() && u.pin === passwordInput);

            if (user) {
                // Success
                app.state.currentUser = user;

                // Update Sidebar
                document.getElementById('sidebar-username').innerText = user.name;
                document.getElementById('sidebar-role').innerText = user.role.toUpperCase();
                document.getElementById('sidebar-avatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6366f1&color=fff`;

                // Show Admin specific nav
                if (user.role === 'admin') {
                    document.getElementById('nav-users').classList.remove('hidden');
                } else {
                    document.getElementById('nav-users').classList.add('hidden');
                }

                // Hide Modal
                const modal = document.getElementById('login-modal');
                modal.classList.add('opacity-0', 'pointer-events-none');
                setTimeout(() => modal.classList.add('hidden'), 300);

                // Load initial data
                app.showSection('dashboard');

                // Clear errors
                errorMsg.classList.add('hidden');

            } else {
                errorMsg.innerText = "Invalid Username or Password";
                errorMsg.classList.remove('hidden');
            }
        } catch (e) {
            console.error("Login error", e);
            errorMsg.innerText = "Login Failed";
            errorMsg.classList.remove('hidden');
        }
    },

    logout: async () => {
        app.state.currentUser = null;
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';

        document.getElementById('login-error').classList.add('hidden');

        // Clear sidebar info
        document.getElementById('sidebar-username').innerText = 'User';
        document.getElementById('sidebar-role').innerText = 'Offline';
        document.getElementById('sidebar-avatar').src = 'https://ui-avatars.com/api/?name=User&background=6366f1&color=fff';

        const modal = document.getElementById('login-modal');
        modal.classList.remove('hidden', 'opacity-0', 'pointer-events-none');

        // Reset Admin Nav
        document.getElementById('nav-users').classList.add('hidden');

        app.showToast('Logged out successfully.', 'info');
    },

    // --- Navigation ---
    showSection: async (sectionId) => {
        // Hide all sections
        document.querySelectorAll('section').forEach(el => {
            el.classList.add('hidden');
            el.classList.remove('animate-fade-in');
        });

        // Show target section
        const target = document.getElementById(`section-${sectionId}`);
        if (target) {
            target.classList.remove('hidden');
            void target.offsetWidth;
            target.classList.add('animate-fade-in');
        }

        // Update Nav State
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.remove('active', 'bg-brand-50', 'text-brand-600', 'font-medium');
            el.classList.add('text-gray-500');
        });
        const activeNav = document.getElementById(`nav-${sectionId}`);
        if (activeNav) {
            activeNav.classList.add('active', 'bg-brand-50', 'text-brand-600', 'font-medium');
            activeNav.classList.remove('text-gray-500');
        }

        app.state.activeSection = sectionId;

        // Refresh data
        if (sectionId === 'dashboard') await app.refreshDashboard();
        if (sectionId === 'calls') await app.loadRecordings();
        if (sectionId === 'activities') await app.loadActivities();
        if (sectionId === 'tickets') await app.loadTickets();
        if (sectionId === 'casenotes') await app.loadCaseNotes();
        if (sectionId === 'users' && app.state.currentUser && app.state.currentUser.role === 'admin') await app.loadUsersList();

        // Reset search field
        const searchInput = document.getElementById('global-search');
        if (searchInput) searchInput.value = '';

        // Load inputs if section is calls
        if (sectionId === 'calls') await app.loadAudioInputs();
    },

    handleSearch: async (query) => {
        const section = app.state.activeSection;
        const searchTerm = query.toLowerCase().trim();

        if (section === 'dashboard') await app.refreshDashboard(searchTerm);
        if (section === 'calls') await app.loadRecordings(searchTerm);
        if (section === 'activities') await app.loadActivities(searchTerm);
        if (section === 'tickets') await app.loadTickets(searchTerm);
        if (section === 'casenotes') await app.loadCaseNotes(searchTerm);
    },

    // --- Media Hardware ---
    loadAudioInputs: async () => {
        try {
            // Must ask permission first to get labels
            await navigator.mediaDevices.getUserMedia({ audio: true });

            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            const select = document.getElementById('mic-select');

            // Save current selection
            const currentVal = select.value;
            select.innerHTML = '';

            if (audioInputs.length === 0) {
                const opt = document.createElement('option');
                opt.value = "";
                opt.innerText = "No Microphones Found";
                select.appendChild(opt);
                return;
            }

            audioInputs.forEach((device, index) => {
                const opt = document.createElement('option');
                opt.value = device.deviceId;
                opt.innerText = device.label || `Microphone ${index + 1}`;
                select.appendChild(opt);
            });

            // Restore selection if still exists
            if (currentVal) select.value = currentVal;

        } catch (e) {
            console.error("Error loading audio inputs", e);
            // Fail silently but log, maybe permission denied
        }
    },

    // --- Dashboard Logic ---
    refreshDashboard: async (searchTerm = '') => {
        if (!app.state.currentUser) return;

        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Global visibility: Everyone sees total counts
            callsCount = await db.calls.where('timestamp').aboveOrEqual(today.getTime()).count();
            pendingTasks = await db.activities.where('status').equals('pending').count();
            openTickets = await db.tickets.where('status').equals('Open').count();

            document.getElementById('dash-calls-count').innerText = callsCount;
            document.getElementById('dash-tasks-count').innerText = pendingTasks;
            document.getElementById('dash-tickets-count').innerText = openTickets;

            // --- Sparklines and Main Chart Logic ---
            app.renderCharts();

            // Load recent recordings (Global)
            if (searchTerm) {
                recentCalls = await db.calls.filter(c => c.clientName.toLowerCase().includes(searchTerm)).reverse().toArray();
            } else {
                recentCalls = await db.calls.orderBy('timestamp').reverse().limit(5).toArray();
            }

            // Need to fetch user names
            const dashList = document.getElementById('dashboard-recordings-list');
            dashList.innerHTML = '';

            if (recentCalls.length === 0) {
                document.getElementById('dash-empty-state').classList.remove('hidden');
            } else {
                document.getElementById('dash-empty-state').classList.add('hidden');

                const users = await db.users.toArray();
                const userMap = {};
                users.forEach(u => userMap[u.id] = u.name);

                recentCalls.forEach(call => {
                    const callDate = new Date(call.timestamp);
                    const timeStr = callDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const dateStr = callDate.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: 'numeric' });
                    const callerName = userMap[call.userId] || 'Unknown';

                    const row = `
                        <tr class="hover:bg-gray-50/80 transition-all border-b border-gray-50 last:border-0 group">
                            <td class="py-4 px-2">
                                <div class="flex items-center gap-3">
                                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(callerName)}&background=0ea5e9&color=fff" class="h-8 w-8 rounded-lg shadow-sm">
                                    <span class="font-bold text-gray-700">${callerName}</span>
                                </div>
                            </td>
                            <td class="py-4 px-2">
                                <span class="text-gray-900 font-semibold">${call.clientName || 'Unknown Client'}</span>
                            </td>
                            <td class="py-4 px-2">
                                <span class="text-gray-500 font-medium">${dateStr}</span>
                            </td>
                            <td class="py-4 px-2 font-medium text-gray-500">${app.formatTime(call.duration)}</td>
                            <td class="py-4 px-2 font-medium text-gray-500">${timeStr}</td>
                            <td class="py-4 px-2 text-right">
                                <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                                    <button onclick="app.playRecording(${call.id})" class="h-8 w-8 rounded-lg bg-brand-50 text-brand-500 hover:bg-brand-500 hover:text-white transition-all shadow-sm" title="Play">
                                        <i class="fa-solid fa-play text-[10px]"></i>
                                    </button>
                                    <button onclick="app.downloadRecording(${call.id})" class="h-8 w-8 rounded-lg bg-brand-50 text-brand-500 hover:bg-brand-500 hover:text-white transition-all shadow-sm" title="Download">
                                        <i class="fa-solid fa-download text-[10px]"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                    dashList.innerHTML += row;
                });
            }

        } catch (e) {
            console.error("Error refreshing dashboard:", e);
        }
    },

    renderCharts: async () => {
        const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const currentYear = new Date().getFullYear();

        // Initialize arrays with zeros
        const callData = new Array(12).fill(0);
        const ticketData = new Array(12).fill(0);

        try {
            // Global chart data
            const userCalls = await db.calls.toArray();
            const userTickets = await db.tickets.toArray();

            // Fetch calls and group by month
            userCalls.forEach(call => {
                const date = new Date(call.timestamp);
                if (date.getFullYear() === currentYear) {
                    callData[date.getMonth()]++;
                }
            });

            // Fetch tickets and group by month
            userTickets.forEach(ticket => {
                const date = new Date(ticket.createdAt || Date.now());
                if (date.getFullYear() === currentYear) {
                    ticketData[date.getMonth()]++;
                }
            });
        } catch (e) {
            console.error("Error fetching chart data:", e);
        }

        const ctx = document.getElementById('performance-chart');
        if (!ctx) return;

        // Destroy previous chart if exists
        if (app.state.perfChartInstance) app.state.perfChartInstance.destroy();

        // Pass filtered data pools for sparklines (Global)
        const filteredCalls = await db.calls.toArray();
        const filteredTickets = await db.tickets.toArray();
        const filteredActivities = await db.activities.toArray();

        app.state.perfChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Calls',
                        data: callData,
                        backgroundColor: '#0ea5e9',
                        borderRadius: 6,
                        barThickness: 12,
                    },
                    {
                        label: 'Tickets',
                        data: ticketData,
                        backgroundColor: '#f97316',
                        borderRadius: 6,
                        barThickness: 12,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'center',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 20,
                            font: { family: 'Outfit', weight: '600', size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        padding: 12,
                        titleFont: { family: 'Outfit', size: 13 },
                        bodyFont: { family: 'Outfit', size: 12 },
                        cornerRadius: 8
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { drawBorder: false, color: '#f1f5f9' },
                        ticks: { font: { family: 'Outfit', weight: '500' }, color: '#94a3b8', padding: 10 }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { family: 'Outfit', weight: '500' }, color: '#94a3b8', padding: 10 }
                    }
                }
            }
        });

        // --- Sparklines (Last 7 Days) ---
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            d.setHours(0, 0, 0, 0);
            last7Days.push(d.getTime());
        }

        const callsSparkData = new Array(7).fill(0);
        const tasksSparkData = new Array(7).fill(0);
        const ticketsSparkData = new Array(7).fill(0);

        const allActivities = await db.activities.toArray();

        for (let j = 0; j < 7; j++) {
            const dayStart = last7Days[j];
            const dayEnd = dayStart + 86400000;

            callsSparkData[j] = filteredCalls.filter(c => c.timestamp >= dayStart && c.timestamp < dayEnd).length;
            ticketsSparkData[j] = filteredTickets.filter(t => (t.createdAt || Date.now()) >= dayStart && (t.createdAt || Date.now()) < dayEnd).length;
            tasksSparkData[j] = filteredActivities.filter(a => a.timestamp >= dayStart && a.timestamp < dayEnd).length;
        }

        app.renderSparkline('calls-sparkline', callsSparkData, '#0ea5e9');
        app.renderSparkline('tasks-sparkline', tasksSparkData, '#f97316');
        app.renderSparkline('tickets-sparkline', ticketsSparkData, '#ef4444');
    },

    renderSparkline: (canvasId, data, color) => {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        if (app.state[canvasId]) app.state[canvasId].destroy();

        app.state[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: new Array(data.length).fill(''),
                datasets: [{
                    data: data,
                    borderColor: color,
                    borderWidth: 3,
                    pointRadius: 0,
                    tension: 0.4,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false } }
            }
        });
    },

    // --- User Management (Admin) ---
    showAddUserModal: () => {
        const modal = document.getElementById('add-user-modal');
        modal.classList.remove('hidden');
        void modal.offsetWidth;
        modal.classList.remove('opacity-0');
        document.getElementById('add-user-modal-content').classList.remove('scale-95');
        document.getElementById('add-user-modal-content').classList.add('scale-100');
    },

    closeAddUserModal: () => {
        const modal = document.getElementById('add-user-modal');
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 300);
        document.getElementById('new-user-name').value = '';
        document.getElementById('new-user-pin').value = '';
    },

    createUser: async () => {
        const name = document.getElementById('new-user-name').value.trim();
        const pin = document.getElementById('new-user-pin').value.trim();
        const role = document.getElementById('new-user-role').value;

        if (!name || !pin) {
            app.showToast('Name and PIN are required.', 'error');
            return;
        }

        const existing = await db.users.where('name').equalsIgnoreCase(name).first();
        if (existing) {
            app.showToast('User already exists!', 'error');
            return;
        }

        await db.users.add({ name, pin, role });
        app.showToast('User created successfully.', 'success');
        app.closeAddUserModal();
        app.loadUsersList();
    },

    loadUsersList: async () => {
        if (!app.state.currentUser) return;
        const list = document.getElementById('users-list');
        list.innerHTML = '';
        const users = await db.users.toArray();

        users.forEach(user => {
            const isMe = user.id === app.state.currentUser.id;
            const card = document.createElement('div');
            card.className = 'glass p-4 rounded-xl flex items-center justify-between border border-gray-100';
            card.innerHTML = `
                <div class="flex items-center gap-3">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=${user.role === 'admin' ? '6366f1' : '10b981'}&color=fff" class="h-10 w-10 rounded-full" alt="Profile">
                    <div>
                        <p class="font-bold text-gray-800 text-sm">${user.name} ${isMe ? '(You)' : ''}</p>
                        <p class="text-xs text-gray-500 uppercase">${user.role} • PIN: ${isMe || app.state.currentUser.role === 'admin' ? user.pin : '****'}</p>
                    </div>
                </div>
                ${!isMe ? `
                <button onclick="app.deleteUser(${user.id})" class="text-gray-400 hover:text-red-500 p-2 transition-colors">
                    <i class="fa-solid fa-trash"></i>
                </button>` : ''}
            `;
            list.appendChild(card);
        });
    },

    deleteUser: async (id) => {
        if (!app.state.currentUser || app.state.currentUser.role !== 'admin') {
            app.showToast('Only admins can delete users.', 'error');
            return;
        }
        if (confirm('Delete this user? This will not delete their historical data.')) {
            await db.users.delete(id);
            app.loadUsersList();
            app.showToast('User deleted.', 'info');
        }
    },


    // --- Recording Logic ---
    toggleRecording: async () => {
        if (app.state.isRecording) {
            app.stopRecording();
        } else {
            await app.startRecording();
        }
    },

    startRecording: async () => {
        try {
            const deviceId = document.getElementById('mic-select').value;
            const constraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            // Detect best supported mime type
            let mimeType = 'audio/webm';
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                mimeType = 'audio/webm;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                mimeType = 'audio/mp4';
            }
            console.log("Using MimeType:", mimeType);

            app.state.mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
            app.state.audioChunks = [];

            app.state.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    app.state.audioChunks.push(event.data);
                }
            };

            app.state.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(app.state.audioChunks, { type: mimeType });
                app.state.currentBlob = audioBlob;

                document.getElementById('btn-save').disabled = false;

                document.getElementById('btn-record').innerHTML = '<i class="fa-solid fa-microphone"></i> <span>Start Rec</span>';
                document.getElementById('btn-record').classList.remove('bg-red-500', 'animate-pulse');
                document.getElementById('btn-record').classList.add('bg-gray-900');

                document.getElementById('pulse-ring').classList.remove('recording-pulse');
                document.getElementById('pulse-ring').style.opacity = '0';

                document.getElementById('recording-status').innerText = 'Recorded';
                document.getElementById('recording-status').className = 'mb-4 px-3 py-1 rounded-full bg-green-100 text-green-600 text-xs font-bold uppercase tracking-wider transition-colors';

                app.showToast('Recording finished. Ready to save.', 'success');
            };

            app.state.mediaRecorder.start();
            app.state.isRecording = true;
            app.state.recordingStartTime = Date.now();

            document.getElementById('btn-record').innerHTML = '<i class="fa-solid fa-stop"></i> <span>Stop Rec</span>';
            document.getElementById('btn-record').classList.remove('bg-gray-900');
            document.getElementById('btn-record').classList.add('bg-red-500', 'animate-pulse');

            document.getElementById('pulse-ring').classList.add('recording-pulse');
            document.getElementById('pulse-ring').style.opacity = '1';

            document.getElementById('recording-status').innerText = 'Recording...';
            document.getElementById('recording-status').className = 'mb-4 px-3 py-1 rounded-full bg-red-100 text-red-600 text-xs font-bold uppercase tracking-wider transition-colors';

            app.state.timerInterval = setInterval(() => {
                const duration = Math.floor((Date.now() - app.state.recordingStartTime) / 1000);
                app.state.currentDuration = duration;
                document.getElementById('timer-display').innerText = app.formatTime(duration);
            }, 1000);

        } catch (err) {
            console.error('Error accessing microphone:', err);
            app.showToast('Microphone access denied or not supported.', 'error');
        }
    },

    stopRecording: () => {
        if (app.state.mediaRecorder && app.state.isRecording) {
            app.state.mediaRecorder.stop();
            app.state.isRecording = false;
            clearInterval(app.state.timerInterval);
            app.state.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    },

    saveRecording: async () => {
        if (!app.state.currentBlob) return;
        if (!app.state.currentUser) {
            app.showToast('Please login to save recordings.', 'error');
            return;
        }

        const clientName = document.getElementById('client-name-input').value.trim() || 'Anonymous Client';

        try {
            const now = new Date();
            const dateString = now.toISOString().split('T')[0]; // YYYY-MM-DD

            await db.calls.add({
                clientName: clientName,
                duration: app.state.currentDuration,
                recordingBlob: app.state.currentBlob,
                timestamp: Date.now(),
                dateString: dateString, // Save Date
                userId: app.state.currentUser.id
            });

            app.showToast('Recording saved successfully!', 'success');

            document.getElementById('client-name-input').value = '';
            document.getElementById('timer-display').innerText = '00:00';
            document.getElementById('btn-save').disabled = true;
            document.getElementById('recording-status').innerText = 'Ready';
            document.getElementById('recording-status').className = 'mb-4 px-3 py-1 rounded-full bg-gray-100 text-gray-500 text-xs font-bold uppercase tracking-wider transition-colors';

            app.state.currentBlob = null;
            app.state.currentDuration = 0;

            app.loadRecordings();

        } catch (e) {
            console.error('Error saving recording:', e);
            app.showToast('Failed to save recording.', 'error');
        }
    },

    loadRecordings: async (searchTerm = '') => {
        const list = document.getElementById('recordings-list');
        list.innerHTML = '';

        // Global visibility for recordings
        const calls = await db.calls.orderBy('timestamp').reverse().toArray();

        if (searchTerm) {
            calls = calls.filter(c => c.clientName && c.clientName.toLowerCase().includes(searchTerm));
        }

        if (calls.length === 0) {
            list.innerHTML = `<div class="text-center py-10 text-gray-400"><p>No recordings yet.</p></div>`;
            return;
        }

        // Fetch users to map IDs to names
        const users = await db.users.toArray();
        const userMap = {};
        users.forEach(u => userMap[u.id] = u.name);

        calls.forEach(call => {
            const date = new Date(call.timestamp).toLocaleString();
            const ownerName = userMap[call.userId] || 'System';
            const item = document.createElement('div');
            item.className = 'flex items-center justify-between p-4 bg-white/50 rounded-xl hover:bg-white border border-gray-100 transition-all group shadow-sm';
            item.innerHTML = `
                <div class="flex items-center gap-4">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(ownerName)}&background=f0f9ff&color=0ea5e9" class="h-10 w-10 rounded-xl shadow-sm" />
                    <div>
                        <h4 class="font-bold text-gray-800 text-sm">${call.clientName}</h4>
                        <div class="flex items-center gap-2">
                             <p class="text-xs text-gray-500">${call.dateString || date.split(',')[0]} • ${app.formatTime(call.duration)}</p>
                             <span class="text-[9px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 font-bold uppercase">${ownerName}</span>
                        </div>
                    </div>
                </div>
                <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="app.playRecording(${call.id})" class="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 flex items-center justify-center transition-colors" title="Play">
                        <i class="fa-solid fa-play text-xs"></i>
                    </button>
                    <button onclick="app.downloadRecording(${call.id})" class="h-8 w-8 rounded-lg bg-sky-100 text-sky-600 hover:bg-sky-200 flex items-center justify-center transition-colors" title="Download">
                        <i class="fa-solid fa-download text-xs"></i>
                    </button>
                    <button onclick="app.editCall(${call.id})" class="h-8 w-8 rounded-lg bg-brand-100 text-brand-600 hover:bg-brand-200 flex items-center justify-center transition-colors" title="Edit">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    ${app.state.currentUser.role === 'admin' ?
                    `<button onclick="app.deleteCall(${call.id})" class="h-8 w-8 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center transition-colors" title="Delete">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>` : ''}
                </div>
            `;
            list.appendChild(item);
        });
    },

    editCall: async (id) => {
        const call = await db.calls.get(id);
        if (!call) return;

        document.getElementById('edit-call-id').value = call.id;
        document.getElementById('edit-call-client').value = call.clientName;
        document.getElementById('edit-call-date').value = call.dateString || "";

        const modal = document.getElementById('edit-call-modal');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            document.getElementById('edit-call-modal-content').classList.remove('scale-95');
            document.getElementById('edit-call-modal-content').classList.add('scale-100');
        }, 10);
    },

    updateCall: async () => {
        const id = parseInt(document.getElementById('edit-call-id').value);
        const clientName = document.getElementById('edit-call-client').value.trim();
        const dateString = document.getElementById('edit-call-date').value;

        if (!clientName) {
            app.showToast('Client name is required.', 'error');
            return;
        }

        try {
            await db.calls.update(id, {
                clientName,
                dateString
            });

            // If there are linked tickets, update their dateString too potentially? 
            // Usually tickets have their own life, but let's keep it simple.

            app.showToast('Recording updated successfully.', 'success');
            app.closeEditCallModal();
            app.loadRecordings();
        } catch (e) {
            console.error("Error updating call", e);
            app.showToast('Failed to update recording.', 'error');
        }
    },

    closeEditCallModal: () => {
        const modal = document.getElementById('edit-call-modal');
        modal.classList.add('opacity-0');
        document.getElementById('edit-call-modal-content').classList.add('scale-95');
        document.getElementById('edit-call-modal-content').classList.remove('scale-100');
        setTimeout(() => modal.classList.add('hidden'), 300);
    },

    playRecording: async (id) => {
        app.state.currentPlayingCallId = id;
        const call = await db.calls.get(id);
        if (!call) return;

        if (app.state.audioUrl) {
            URL.revokeObjectURL(app.state.audioUrl);
        }

        const blob = call.recordingBlob;
        app.state.audioUrl = URL.createObjectURL(blob);

        const player = document.getElementById('main-audio-player');

        // Ensure volume is acceptable
        player.volume = 1.0;

        // Try to select default audio output if supported (setSinkId)
        try {
            if (player.setSinkId) {
                // Empty string is default device
                await player.setSinkId('');
                console.log('Audio output set to default');
            }
        } catch (e) {
            console.warn('Could not set custom sinkId', e);
        }

        player.src = app.state.audioUrl;

        document.getElementById('modal-client-name').innerText = `Recording: ${call.clientName}`;
        const modal = document.getElementById('audio-modal');
        modal.classList.remove('hidden', 'opacity-0');
        document.getElementById('audio-modal-content').classList.remove('scale-95');
        document.getElementById('audio-modal-content').classList.add('scale-100');

        player.play();
    },

    downloadRecording: async (id) => {
        try {
            const call = await db.calls.get(id);
            if (!call || !call.recordingBlob) {
                app.showToast('Recording file not found.', 'error');
                return;
            }

            const url = URL.createObjectURL(call.recordingBlob);
            const a = document.createElement('a');
            a.href = url;
            const dateStr = call.dateString || new Date(call.timestamp).toISOString().split('T')[0];
            const safeClientName = (call.clientName || 'Unknown').replace(/[^a-z0-9]/gi, '_');
            a.download = `MISL_REC_${safeClientName}_${dateStr}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            app.showToast('Recording downloaded successfully!', 'success');
        } catch (e) {
            console.error('Download failed:', e);
            app.showToast('Failed to download recording.', 'error');
        }
    },

    closeAudioModal: () => {
        const modal = document.getElementById('audio-modal');
        modal.classList.add('opacity-0');
        document.getElementById('audio-modal-content').classList.add('scale-95');
        document.getElementById('audio-modal-content').classList.remove('scale-100');

        const player = document.getElementById('main-audio-player');
        player.pause();

        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
    },

    deleteCurrentRecording: async () => {
        // Called from modal
        if (app.state.currentPlayingCallId) {
            app.closeAudioModal();
            app.deleteCall(app.state.currentPlayingCallId);
        }
    },

    createTicketFromRecording: async () => {
        // Called from modal
        if (app.state.currentPlayingCallId) {
            app.closeAudioModal();
            app.createTicketFromCall(app.state.currentPlayingCallId);
        }
    },

    deleteCall: async (id) => {
        if (confirm('Are you sure you want to delete this recording? Associated tickets will also be deleted.')) {
            await db.calls.delete(id);
            // Cleanup tickets related to this call
            const relatedTickets = await db.tickets.where('callId').equals(id).toArray();
            for (const ticket of relatedTickets) {
                await db.tickets.delete(ticket.id);
            }
            app.loadRecordings();
            app.showToast('Recording and associated tickets deleted.', 'info');
        }
    },

    // --- Activities Logic ---
    loadActivities: async (searchTerm = '') => {
        if (!app.state.currentUser) return;
        const list = document.getElementById('tasks-list');
        list.innerHTML = '';

        const tasksCountBadge = document.getElementById('task-count-badge');

        // Global visibility for tasks
        const tasks = await db.activities.orderBy('timestamp').reverse().toArray();

        if (searchTerm) {
            tasks = tasks.filter(t => t.title && t.title.toLowerCase().includes(searchTerm));
        }
        const pendingCount = tasks.filter(t => t.status === 'pending').length;

        if (tasksCountBadge) tasksCountBadge.innerText = `${pendingCount} Pending`;

        if (tasks.length === 0) {
            list.innerHTML = `<div class="text-center py-8 text-gray-400">No tasks for today. Great job!</div>`;
            return;
        }

        // Fetch users to map IDs to names
        const users = await db.users.toArray();
        const userMap = {};
        users.forEach(u => userMap[u.id] = u.name);

        tasks.forEach(task => {
            const isDone = task.status === 'completed';
            const ownerName = userMap[task.userId] || 'System';
            const item = document.createElement('div');
            item.className = `flex items-center justify-between p-4 rounded-xl border transition-all ${isDone ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-100 shadow-sm'}`;
            item.innerHTML = `
                <div class="flex items-center gap-3">
                    <button onclick="app.toggleTask(${task.id})" class="h-6 w-6 rounded-md border flex items-center justify-center transition-colors ${isDone ? 'bg-brand-500 border-brand-500 text-white' : 'border-gray-300 hover:border-brand-500'}">
                        ${isDone ? '<i class="fa-solid fa-check text-xs"></i>' : ''}
                    </button>
                    <div>
                        <span class="${isDone ? 'line-through text-gray-500' : 'text-gray-800 font-medium'} text-sm">${task.title}</span>
                        <div class="text-[10px] text-gray-400 font-bold uppercase mt-0.5">Owner: ${ownerName}</div>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="app.editTask(${task.id})" class="text-gray-400 hover:text-brand-600 transition-colors" title="Edit">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button onclick="app.deleteTask(${task.id})" class="text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                        <i class="fa-solid fa-xmark text-xs"></i>
                    </button>
                </div>
            `;
            list.appendChild(item);
        });
    },

    editTask: async (id) => {
        const task = await db.activities.get(id);
        if (!task) return;

        document.getElementById('edit-task-id').value = task.id;
        document.getElementById('edit-task-title').value = task.title;

        const modal = document.getElementById('edit-task-modal');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            document.getElementById('edit-task-modal-content').classList.remove('scale-95');
            document.getElementById('edit-task-modal-content').classList.add('scale-100');
        }, 10);
    },

    updateTask: async () => {
        const id = parseInt(document.getElementById('edit-task-id').value);
        const title = document.getElementById('edit-task-title').value.trim();

        if (!title) {
            app.showToast('Task title is required.', 'error');
            return;
        }

        try {
            await db.activities.update(id, { title });
            app.showToast('Task updated successfully.', 'success');
            app.closeEditTaskModal();
            app.loadActivities();
        } catch (e) {
            console.error("Error updating task", e);
            app.showToast('Failed to update task.', 'error');
        }
    },

    closeEditTaskModal: () => {
        const modal = document.getElementById('edit-task-modal');
        modal.classList.add('opacity-0');
        document.getElementById('edit-task-modal-content').classList.add('scale-95');
        document.getElementById('edit-task-modal-content').classList.remove('scale-100');
        setTimeout(() => modal.classList.add('hidden'), 300);
    },

    addTask: async () => {
        if (!app.state.currentUser) {
            app.showToast('Please login to add tasks.', 'error');
            return;
        }
        const input = document.getElementById('new-task-input');
        const title = input.value.trim();
        if (!title) return;

        await db.activities.add({
            title,
            status: 'pending',
            timestamp: Date.now(),
            userId: app.state.currentUser.id // Save ID
        });

        input.value = '';
        app.loadActivities();
        app.showToast('Task added.', 'success');
    },

    toggleTask: async (id) => {
        const task = await db.activities.get(id);
        const newStatus = task.status === 'pending' ? 'completed' : 'pending';
        await db.activities.update(id, { status: newStatus });
        app.loadActivities();
    },

    deleteTask: async (id) => {
        await db.activities.delete(id);
        app.loadActivities();
    },

    // --- Tickets Logic (Kanban Board) ---
    loadTickets: async (searchTerm = '') => {
        if (!app.state.currentUser) return;
        const board = document.getElementById('tickets-kanban-board');
        board.innerHTML = '';

        // Global visibility for tickets
        const tickets = await db.tickets.orderBy('createdAt').reverse().toArray();

        if (searchTerm) {
            tickets = tickets.filter(t =>
                (t.description && t.description.toLowerCase().includes(searchTerm)) ||
                (t.clientName && t.clientName.toLowerCase().includes(searchTerm))
            );
        }

        if (tickets.length === 0) {
            board.innerHTML = '';
            document.getElementById('tickets-empty-state').classList.remove('hidden');
            return;
        }
        document.getElementById('tickets-empty-state').classList.add('hidden');

        // Fetch users to map IDs to names
        const users = await db.users.toArray();
        const userMap = {};
        users.forEach(u => userMap[u.id] = u.name);

        // Group tickets by Client Name
        const grouped = { 'Unassigned': [] };
        tickets.forEach(t => {
            const client = t.clientName || 'Unassigned';
            if (!grouped[client]) grouped[client] = [];
            grouped[client].push(t);
        });

        // Ensure Unassigned is first, then alphabetical
        const clientNames = Object.keys(grouped).sort((a, b) => {
            if (a === 'Unassigned') return -1;
            if (b === 'Unassigned') return 1;
            return a.localeCompare(b);
        });

        clientNames.forEach(client => {
            const ticketsInColumn = grouped[client];
            const column = document.createElement('div');
            column.className = 'kanban-column flex-shrink-0 w-80 bg-gray-50/50 rounded-[2rem] p-4 flex flex-col min-h-[400px] border border-gray-100/50';
            column.dataset.client = client;

            // Drag & Drop events for column
            column.ondragover = (e) => {
                e.preventDefault();
                column.classList.add('bg-brand-50/50');
            };
            column.ondragleave = () => {
                column.classList.remove('bg-brand-50/50');
            };
            column.ondrop = (e) => {
                e.preventDefault();
                column.classList.remove('bg-brand-50/50');
                const ticketId = e.dataTransfer.getData('text/plain');
                app.moveTicketToClient(parseInt(ticketId), client);
            };

            column.innerHTML = `
                <div class="flex items-center justify-between mb-4 px-2">
                    <h4 class="font-bold text-gray-700 text-sm flex items-center gap-2">
                        ${client}
                        <span class="bg-gray-200 text-gray-500 text-[10px] px-1.5 py-0.5 rounded-full">${ticketsInColumn.length}</span>
                    </h4>
                </div>
                <div class="flex-1 space-y-4">
                    ${ticketsInColumn.map(ticket => {
                const urgencyBadge = ticket.priority === 'High' ? 'text-red-600 bg-red-100' : (ticket.priority === 'Medium' ? 'text-orange-600 bg-orange-100' : 'text-blue-600 bg-blue-100');
                const cardBg = ticket.priority === 'High' ? 'bg-red-50/60 border-red-100' : (ticket.priority === 'Medium' ? 'bg-amber-50/60 border-amber-100' : 'bg-blue-50/60 border-blue-100');
                const accentColor = ticket.priority === 'High' ? 'bg-red-500' : (ticket.priority === 'Medium' ? 'bg-amber-500' : 'bg-blue-500');
                const assigneeName = userMap[ticket.assigneeId] || 'Unassigned';
                return `
                        <div draggable="true" ondragstart="event.dataTransfer.setData('text/plain', '${ticket.id}')"
                             class="${cardBg} p-5 rounded-2xl shadow-sm border hover:shadow-md transition-all cursor-grab active:cursor-grabbing group relative overflow-hidden">
                            <div class="absolute top-0 left-0 w-1 h-full ${accentColor}"></div>
                            <div class="flex justify-between items-start mb-3">
                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Card #${ticket.id}</span>
                                <span class="text-[10px] text-gray-400">ID #${ticket.id}</span>
                            </div>
                            <div class="flex items-center gap-2 mb-3">
                                <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(assigneeName)}&background=fff&color=1e293b" class="h-6 w-6 rounded-lg pointer-events-none shadow-sm" />
                                <span class="text-xs font-bold text-gray-700">${assigneeName}</span>
                                <span class="ml-auto px-2 py-0.5 rounded text-[10px] font-bold ${urgencyBadge}">${ticket.priority}</span>
                            </div>
                            <p class="text-[13px] text-gray-600 line-clamp-2 mb-4 leading-relaxed font-medium">
                                ${(ticket.description || '').replace(/^•\s*/, '')}
                            </p>
                            <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                <button onclick="app.editTicket(${ticket.id})" class="h-7 w-7 rounded-lg bg-gray-50 text-gray-400 hover:bg-brand-50 hover:text-brand-600 transition-all flex items-center justify-center">
                                    <i class="fa-solid fa-pen text-[10px]"></i>
                                </button>
                                ${app.state.currentUser.role === 'admin' ? `
                                <button onclick="app.deleteTicket(${ticket.id})" class="h-7 w-7 rounded-lg bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all flex items-center justify-center">
                                    <i class="fa-solid fa-trash text-[10px]"></i>
                                </button>` : ''}
                            </div>
                        </div>
                        `;
            }).join('')}
                </div>
            `;
            board.appendChild(column);
        });
    },

    moveTicketToClient: async (ticketId, clientName) => {
        try {
            const finalClient = clientName === 'Unassigned' ? '' : clientName;
            await db.tickets.update(ticketId, { clientName: finalClient });
            app.loadTickets();
            app.showToast(`Ticket #${ticketId} moved to ${clientName}`, 'success');
        } catch (e) {
            console.error("Error moving ticket", e);
            app.showToast("Failed to move ticket.", "error");
        }
    },

    exportTickets: async () => {
        if (!app.state.currentUser) return;

        let tickets;
        if (app.state.currentUser.role === 'admin') {
            tickets = await db.tickets.orderBy('createdAt').reverse().toArray();
        } else {
            const myTickets = await db.tickets.where('userId').equals(app.state.currentUser.id).toArray();
            tickets = myTickets.sort((a, b) => b.createdAt - a.createdAt);
        }

        if (tickets.length === 0) {
            app.showToast('No tickets to export.', 'info');
            return;
        }

        const users = await db.users.toArray();
        const userMap = {};
        users.forEach(u => userMap[u.id] = u.name);

        // CSV Header
        const headers = ["ID", "Date", "Assignee", "Priority", "Related Call", "Description", "Status"];

        // CSV Rows
        const rows = tickets.map(t => {
            const assigneeName = userMap[t.assigneeId] || 'Unassigned';
            const relatedCall = t.callId ? `Call #${t.callId}` : 'Manual Entry';
            // Keep original description with bullet points and newlines
            const cleanDesc = t.description;

            return [
                t.id,
                t.dateString || 'No Date',
                assigneeName,
                t.priority,
                relatedCall,
                cleanDesc,
                t.status
            ];
        });

        // Combine into CSV string
        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        // Trigger Download - Add UTF-8 BOM (\uFEFF) so Excel reads characters like bullet points correctly
        const blob = new Blob(["\uFEFF", csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `MISL_Tickets_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        app.showToast('Tickets exported to CSV/Excel.', 'success');
    },

    createTicketFromCall: async (callId) => {
        const call = await db.calls.get(callId);
        if (!call) return;

        const description = prompt(`Enter ticket description for ${call.clientName || 'this call'}:`);
        if (!description) return;

        // Auto assign today's date for call tickets
        const dateString = new Date().toISOString().split('T')[0];

        await db.tickets.add({
            callId: callId,
            status: 'Open',
            description: description,
            clientName: call.clientName || '',
            priority: 'Medium',
            createdAt: Date.now(),
            dateString: dateString,
            userId: app.state.currentUser.id
        });

        app.showToast('Ticket created from call.', 'success');
        app.showSection('tickets');
    },

    showAddTicketModal: async () => {
        if (!app.state.currentUser) return;

        // Reset and show modal
        document.getElementById('add-ticket-client').value = '';
        document.getElementById('add-ticket-description').value = '';
        document.getElementById('add-ticket-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('add-ticket-priority').value = 'Medium';

        const select = document.getElementById('add-ticket-assignee');
        select.innerHTML = '<option value="">Unassigned</option>';
        const users = await db.users.toArray();
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.innerText = u.name;
            if (u.id === app.state.currentUser.id) opt.selected = true;
            select.appendChild(opt);
        });

        const modal = document.getElementById('add-ticket-modal');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            document.getElementById('add-ticket-modal-content').classList.remove('scale-95');
            document.getElementById('add-ticket-modal-content').classList.add('scale-100');
        }, 10);
    },

    createTicket: async () => {
        const clientName = document.getElementById('add-ticket-client').value.trim();
        const descriptionRaw = document.getElementById('add-ticket-description').value.trim();
        const assigneeId = parseInt(document.getElementById('add-ticket-assignee').value) || null;
        const priority = document.getElementById('add-ticket-priority').value;
        const dateString = document.getElementById('add-ticket-date').value;

        if (!descriptionRaw) {
            app.showToast('Description is required.', 'error');
            return;
        }

        const description = descriptionRaw.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => line.startsWith('•') ? line : `• ${line}`)
            .join('\n');

        await db.tickets.add({
            callId: null,
            status: 'Open',
            description: description,
            clientName: clientName,
            priority: priority,
            createdAt: Date.now(),
            dateString: dateString,
            assigneeId: assigneeId,
            userId: app.state.currentUser.id
        });

        app.showToast('New ticket created.', 'success');
        app.closeAddTicketModal();
        app.loadTickets();
    },

    closeAddTicketModal: () => {
        const modal = document.getElementById('add-ticket-modal');
        modal.classList.add('opacity-0');
        document.getElementById('add-ticket-modal-content').classList.add('scale-95');
        document.getElementById('add-ticket-modal-content').classList.remove('scale-100');
        setTimeout(() => modal.classList.add('hidden'), 300);
    },

    createTicketManual: async () => {
        // Obsolete - functionality moved to showAddTicketModal
        app.showAddTicketModal();
    },

    deleteTicket: async (id) => {
        if (confirm('Delete this ticket?')) {
            await db.tickets.delete(id);
            app.loadTickets();
            app.showToast('Ticket deleted.', 'info');
        }
    },

    editTicket: async (id) => {
        const ticket = await db.tickets.get(id);
        if (!ticket) return;

        document.getElementById('edit-ticket-id').value = ticket.id;
        document.getElementById('edit-ticket-client').value = ticket.clientName || '';
        document.getElementById('edit-ticket-description').value = ticket.description;
        document.getElementById('edit-ticket-priority').value = ticket.priority;
        document.getElementById('edit-ticket-status').value = ticket.status;
        document.getElementById('edit-ticket-date').value = ticket.dateString || "";

        // Populate Assignee dropdown
        const select = document.getElementById('edit-ticket-assignee');
        select.innerHTML = '<option value="">Unassigned</option>';
        const users = await db.users.toArray();
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.innerText = u.name;
            if (u.id === ticket.assigneeId) opt.selected = true;
            select.appendChild(opt);
        });

        const modal = document.getElementById('edit-ticket-modal');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            document.getElementById('edit-ticket-modal-content').classList.remove('scale-95');
            document.getElementById('edit-ticket-modal-content').classList.add('scale-100');
        }, 10);
    },

    updateTicket: async () => {
        const id = parseInt(document.getElementById('edit-ticket-id').value);
        const clientName = document.getElementById('edit-ticket-client').value.trim();
        const rawDescription = document.getElementById('edit-ticket-description').value.trim();
        const assigneeId = parseInt(document.getElementById('edit-ticket-assignee').value) || null;
        const priority = document.getElementById('edit-ticket-priority').value;
        const status = document.getElementById('edit-ticket-status').value;
        const dateString = document.getElementById('edit-ticket-date').value;

        if (!rawDescription) {
            app.showToast('Description is required.', 'error');
            return;
        }

        const description = rawDescription.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => line.startsWith('•') ? line : `• ${line}`)
            .join('\n');

        try {
            await db.tickets.update(id, {
                description,
                clientName,
                priority,
                status,
                dateString,
                assigneeId
            });

            app.showToast('Ticket updated successfully.', 'success');
            app.closeEditTicketModal();
            app.loadTickets();
        } catch (e) {
            console.error("Error updating ticket", e);
            app.showToast('Failed to update ticket.', 'error');
        }
    },

    closeEditTicketModal: () => {
        const modal = document.getElementById('edit-ticket-modal');
        modal.classList.add('opacity-0');
        document.getElementById('edit-ticket-modal-content').classList.add('scale-95');
        document.getElementById('edit-ticket-modal-content').classList.remove('scale-100');
        setTimeout(() => modal.classList.add('hidden'), 300);
    },

    // --- Case Notes Logic ---
    loadCaseNotes: async (searchTerm = '') => {
        if (!app.state.currentUser) return;
        const list = document.getElementById('casenotes-list');
        list.innerHTML = '';

        // Global visibility for case notes
        const notes = await db.caseNotes.orderBy('timestamp').reverse().toArray();

        if (searchTerm) {
            notes = notes.filter(n =>
                (n.clientName && n.clientName.toLowerCase().includes(searchTerm)) ||
                (n.notes && n.notes.toLowerCase().includes(searchTerm)) ||
                (n.caseType && n.caseType.toLowerCase().includes(searchTerm))
            );
        }

        if (notes.length === 0) {
            document.getElementById('casenotes-empty-state').classList.remove('hidden');
            return;
        }
        document.getElementById('casenotes-empty-state').classList.add('hidden');

        // Fetch users to map IDs to names
        const usersArray = await db.users.toArray();
        const userMap = {};
        usersArray.forEach(u => userMap[u.id] = u.name);

        notes.forEach(note => {
            const ownerName = userMap[note.userId] || 'System';
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0';
            row.innerHTML = `
                <td class="p-4 text-sm font-medium text-gray-800">${note.dateString}</td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-xs font-bold bg-brand-50 text-brand-700">${note.caseType}</span>
                </td>
                <td class="p-4">
                    <div class="text-sm font-bold text-gray-700">${note.clientName}</div>
                    <div class="text-[10px] text-gray-400 font-bold uppercase">By: ${ownerName}</div>
                </td>
                <td class="p-4 text-sm text-gray-600 max-w-xs truncate">${note.notes}</td>
                <td class="p-4 text-right">
                    <div class="flex justify-end gap-2">
                        <button onclick="app.editCaseNote(${note.id})" class="text-gray-400 hover:text-brand-600 transition-colors">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button onclick="app.deleteCaseNote(${note.id})" class="text-gray-400 hover:text-red-500 transition-colors">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            list.appendChild(row);
        });
    },

    showAddCaseNoteModal: () => {
        document.getElementById('casenote-modal-title').innerText = 'New Case Note';
        document.getElementById('casenote-id').value = '';
        document.getElementById('casenote-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('casenote-type').value = 'Technical';
        document.getElementById('casenote-client').value = '';
        document.getElementById('casenote-content').value = '';

        const modal = document.getElementById('casenote-modal');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            document.getElementById('casenote-modal-content').classList.remove('scale-95');
            document.getElementById('casenote-modal-content').classList.add('scale-100');
        }, 10);
    },

    closeCaseNoteModal: () => {
        const modal = document.getElementById('casenote-modal');
        modal.classList.add('opacity-0');
        document.getElementById('casenote-modal-content').classList.add('scale-95');
        document.getElementById('casenote-modal-content').classList.remove('scale-100');
        setTimeout(() => modal.classList.add('hidden'), 300);
    },

    saveCaseNote: async () => {
        const id = document.getElementById('casenote-id').value;
        const dateString = document.getElementById('casenote-date').value;
        const caseType = document.getElementById('casenote-type').value;
        const clientName = document.getElementById('casenote-client').value;
        const notes = document.getElementById('casenote-content').value;

        if (!dateString || !clientName || !notes) {
            app.showToast('Please fill in all fields.', 'error');
            return;
        }

        const noteData = {
            dateString,
            caseType,
            clientName,
            notes,
            userId: app.state.currentUser.id,
            timestamp: Date.now()
        };

        try {
            if (id) {
                await db.caseNotes.update(parseInt(id), noteData);
            } else {
                await db.caseNotes.add(noteData);
            }
            app.showToast('Case note saved successfully!', 'success');
            app.closeCaseNoteModal();
            app.loadCaseNotes();
        } catch (e) {
            console.error('Failed to save case note:', e);
            app.showToast('Failed to save case note.', 'error');
        }
    },

    editCaseNote: async (id) => {
        const note = await db.caseNotes.get(id);
        if (!note) return;

        document.getElementById('casenote-modal-title').innerText = 'Edit Case Note';
        document.getElementById('casenote-id').value = note.id;
        document.getElementById('casenote-date').value = note.dateString;
        document.getElementById('casenote-type').value = note.caseType;
        document.getElementById('casenote-client').value = note.clientName;
        document.getElementById('casenote-content').value = note.notes;

        const modal = document.getElementById('casenote-modal');
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            document.getElementById('casenote-modal-content').classList.remove('scale-95');
            document.getElementById('casenote-modal-content').classList.add('scale-100');
        }, 10);
    },

    deleteCaseNote: async (id) => {
        if (confirm('Are you sure you want to delete this case note?')) {
            await db.caseNotes.delete(id);
            app.loadCaseNotes();
            app.showToast('Case note deleted.', 'info');
        }
    },

    // --- Helpers ---
    formatTime: (seconds) => {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    },

    showToast: (message, type = 'info') => {
        const container = document.getElementById('toast-container');
        // Check if container exists, if not create it dynamically (missing in index.html, adding fallback)
        let safeContainer = container;
        if (!safeContainer) {
            safeContainer = document.createElement('div');
            safeContainer.id = 'toast-container';
            safeContainer.style.position = 'fixed';
            safeContainer.style.bottom = '20px';
            safeContainer.style.right = '20px';
            safeContainer.style.zIndex = '100';
            document.body.appendChild(safeContainer);
        }

        const toast = document.createElement('div');

        let bg = 'bg-gray-800';
        let icon = 'fa-info-circle';

        if (type === 'success') { bg = 'bg-emerald-600'; icon = 'fa-check-circle'; }
        if (type === 'error') { bg = 'bg-red-600'; icon = 'fa-circle-exclamation'; }

        toast.className = `toast show ${bg} text-white shadow-lg flex items-center gap-3 pr-6 min-w-[300px] cursor-pointer`;
        toast.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <span class="font-medium text-sm">${message}</span>
        `;

        toast.onclick = () => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        };

        safeContainer.appendChild(toast);
    }
};

window.onload = () => app.init();