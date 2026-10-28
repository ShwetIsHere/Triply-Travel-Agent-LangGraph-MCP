let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let isGeneratingPlan = false;

// Warn user if they attempt to reload or navigate away while generating plan
window.addEventListener("beforeunload", function(event) {
    if (isGeneratingPlan) {
        event.preventDefault();
        event.returnValue = "A travel plan is currently being generated. If you reload or leave now, progress will be lost. Are you sure you want to leave?";
        return event.returnValue;
    }
});

const AgentWorkflowStepper = {
    steps: [
        {
            num: 1,
            node: "flight_agent",
            title: "Flights",
            agent: "Flight Agent",
            status: "Flight Agent is analyzing optimal routes & airports via AviationStack...",
            percent: 0,
            duration: 34000
        },
        {
            num: 2,
            node: "hotel_agent",
            title: "Hotels",
            agent: "Hotel Agent",
            status: "Hotel Agent is discovering top stays & rates via Tavily...",
            percent: 25,
            duration: 6500
        },
        {
            num: 3,
            node: "weather_agent",
            title: "Weather",
            agent: "Weather Agent",
            status: "Weather Agent is checking live forecast & climate via OpenWeather...",
            percent: 50,
            duration: 9500
        },
        {
            num: 4,
            node: "itinerary_agent",
            title: "Itinerary",
            agent: "Itinerary Agent",
            status: "Itinerary Agent is generating day-by-day travel plan with Groq...",
            percent: 75,
            duration: 7500
        },
        {
            num: 5,
            node: "final_agent",
            title: "Finalize",
            agent: "Final Agent",
            status: "Final Agent is structuring and polishing your travel guide with Gemini...",
            percent: 100,
            duration: null
        }
    ],
    currentIndex: 0,
    timers: [],
    totalStartTime: null,
    stepStartTimes: [null, null, null, null, null],
    stepDurations: [null, null, null, null, null],
    tickInterval: null,

    startTimerTick() {
        this.stopTimerTick();
        this.tickInterval = setInterval(() => {
            const now = performance.now();

            // Update overall query elapsed time in flow box header
            if (this.totalStartTime) {
                const totalSec = ((now - this.totalStartTime) / 1000).toFixed(1);
                const totalTimerEl = document.getElementById("agentTotalTimer");
                if (totalTimerEl) {
                    totalTimerEl.textContent = `${totalSec}s`;
                }
            }

            // Update currently active step's live running timer
            if (this.currentIndex !== null && this.stepStartTimes[this.currentIndex]) {
                const stepSec = ((now - this.stepStartTimes[this.currentIndex]) / 1000).toFixed(1);
                const stepTimerEl = document.getElementById(`step-time-${this.currentIndex + 1}`);
                if (stepTimerEl) {
                    stepTimerEl.textContent = `${stepSec}s`;
                }
            }
        }, 100);
    },

    stopTimerTick() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    },

    start() {
        this.reset();
        const section = document.getElementById("agentProgressSection");
        if (section) {
            section.classList.remove("hidden");
            section.style.display = "block";
            section.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }

        const now = performance.now();
        this.totalStartTime = now;
        this.stepStartTimes = [now, null, null, null, null];
        this.stepDurations = [null, null, null, null, null];

        for (let i = 1; i <= 5; i++) {
            const el = document.getElementById(`step-time-${i}`);
            if (el) {
                el.textContent = i === 1 ? "0.0s" : "--";
                el.classList.remove("active", "completed");
            }
        }
        const badge = document.getElementById("agentTotalTimeBadge");
        if (badge) badge.classList.remove("completed");

        const notice = document.getElementById("flowEstNotice");
        if (notice) {
            notice.classList.remove("completed");
            notice.innerHTML = `<span class="flow-est-icon">⏳</span><span>Estimated total time: <strong>~70 seconds</strong> as 5 AI agents fetch live flight, hotel, and weather data. Please do not reload.</span>`;
        }

        this.goToStep(0);
        this.startTimerTick();
        this.scheduleNext(0);
    },

    goToStep(index) {
        if (index < 0 || index >= this.steps.length) return;
        const now = performance.now();
        const prev = this.currentIndex;

        // If transitioning from a previous step, freeze its duration
        if (prev !== null && prev !== index) {
            if (this.stepStartTimes[prev] && !this.stepDurations[prev]) {
                const dur = ((now - this.stepStartTimes[prev]) / 1000).toFixed(1);
                this.stepDurations[prev] = `${dur}s`;
                const prevTimerEl = document.getElementById(`step-time-${prev + 1}`);
                if (prevTimerEl) {
                    prevTimerEl.textContent = `${dur}s`;
                    prevTimerEl.classList.remove("active");
                    prevTimerEl.classList.add("completed");
                }
            }
        }

        this.currentIndex = index;
        if (!this.stepStartTimes[index]) {
            this.stepStartTimes[index] = now;
        }

        const currentTimerEl = document.getElementById(`step-time-${index + 1}`);
        if (currentTimerEl) {
            currentTimerEl.classList.add("active");
            currentTimerEl.classList.remove("completed");
        }

        const current = this.steps[index];
        const statusText = document.getElementById("agentStatusText");
        const activeLabel = document.getElementById("agentActiveLabel");
        const trackFill = document.getElementById("stepperTrackFill");

        if (statusText) statusText.textContent = current.status;
        if (activeLabel) activeLabel.textContent = `Agent ${current.num} of 5`;
        if (trackFill) trackFill.style.width = `${current.percent}%`;

        for (let i = 0; i < this.steps.length; i++) {
            const stepEl = document.getElementById(`step-${i + 1}`);
            if (!stepEl) continue;

            const stepNum = stepEl.querySelector(".step-num");
            const stepCheck = stepEl.querySelector(".step-check-svg");

            stepEl.classList.remove("active", "completed");

            if (i < index) {
                stepEl.classList.add("completed");
                if (stepNum) stepNum.classList.add("hidden");
                if (stepCheck) stepCheck.classList.remove("hidden");
            } else if (i === index) {
                stepEl.classList.add("active");
                if (stepNum) stepNum.classList.remove("hidden");
                if (stepCheck) stepCheck.classList.add("hidden");
            } else {
                if (stepNum) stepNum.classList.remove("hidden");
                if (stepCheck) stepCheck.classList.add("hidden");
            }
        }
    },

    activateNode(nodeName) {
        const nodeMap = {
            "flight_agent": 0,
            "hotel_agent": 1,
            "weather_agent": 2,
            "itinerary_agent": 3,
            "final_agent": 4
        };
        if (nodeName in nodeMap) {
            this.clearTimers();
            this.goToStep(nodeMap[nodeName]);
        }
    },

    completeNode(nodeName) {
        const nodeMap = {
            "flight_agent": 0,
            "hotel_agent": 1,
            "weather_agent": 2,
            "itinerary_agent": 3,
            "final_agent": 4
        };
        if (nodeName in nodeMap) {
            this.clearTimers();
            const index = nodeMap[nodeName];
            const now = performance.now();

            if (this.stepStartTimes[index] && !this.stepDurations[index]) {
                const dur = ((now - this.stepStartTimes[index]) / 1000).toFixed(1);
                this.stepDurations[index] = `${dur}s`;
                const stepTimerEl = document.getElementById(`step-time-${index + 1}`);
                if (stepTimerEl) {
                    stepTimerEl.textContent = `${dur}s`;
                    stepTimerEl.classList.remove("active");
                    stepTimerEl.classList.add("completed");
                }
            }

            const stepEl = document.getElementById(`step-${index + 1}`);
            if (stepEl) {
                stepEl.classList.remove("active");
                stepEl.classList.add("completed");
                const stepNum = stepEl.querySelector(".step-num");
                const stepCheck = stepEl.querySelector(".step-check-svg");
                if (stepNum) stepNum.classList.add("hidden");
                if (stepCheck) stepCheck.classList.remove("hidden");
            }
            if (index + 1 < this.steps.length) {
                this.goToStep(index + 1);
            }
        }
    },

    scheduleNext(index) {
        if (index >= this.steps.length - 1) return;
        const current = this.steps[index];
        if (!current.duration) return;

        const timer = setTimeout(() => {
            this.goToStep(index + 1);
            this.scheduleNext(index + 1);
        }, current.duration);

        this.timers.push(timer);
    },

    complete() {
        this.stopTimerTick();
        this.clearTimers();

        const now = performance.now();
        const totalDuration = this.totalStartTime
            ? ((now - this.totalStartTime) / 1000).toFixed(1) + "s"
            : "--";

        // Freeze any un-frozen step durations
        for (let i = 0; i < 5; i++) {
            if (!this.stepDurations[i] && this.stepStartTimes[i]) {
                const dur = ((now - this.stepStartTimes[i]) / 1000).toFixed(1);
                this.stepDurations[i] = `${dur}s`;
            }
            const timerEl = document.getElementById(`step-time-${i + 1}`);
            if (timerEl) {
                if (this.stepDurations[i]) {
                    timerEl.textContent = this.stepDurations[i];
                }
                timerEl.classList.remove("active");
                timerEl.classList.add("completed");
            }
        }

        const trackFill = document.getElementById("stepperTrackFill");
        const statusText = document.getElementById("agentStatusText");
        const activeLabel = document.getElementById("agentActiveLabel");
        const totalTimerEl = document.getElementById("agentTotalTimer");
        const totalBadge = document.getElementById("agentTotalTimeBadge");
        const notice = document.getElementById("flowEstNotice");

        if (trackFill) trackFill.style.width = "100%";
        if (totalTimerEl) totalTimerEl.textContent = `⚡ ${totalDuration}`;
        if (totalBadge) totalBadge.classList.add("completed");
        if (activeLabel) activeLabel.textContent = `Completed (5/5)`;
        if (statusText) statusText.textContent = `🎉 Travel plan generated in ${totalDuration}! All 5 agents completed.`;
        if (notice) {
            notice.classList.add("completed");
            notice.innerHTML = `<span class="flow-est-icon">🎉</span><span>Multi-agent workflow completed in <strong>${totalDuration}</strong>! Full travel plan generated below.</span>`;
        }

        for (let i = 1; i <= 5; i++) {
            const stepEl = document.getElementById(`step-${i}`);
            if (!stepEl) continue;
            stepEl.classList.remove("active");
            stepEl.classList.add("completed");
            const stepNum = stepEl.querySelector(".step-num");
            const stepCheck = stepEl.querySelector(".step-check-svg");
            if (stepNum) stepNum.classList.add("hidden");
            if (stepCheck) stepCheck.classList.remove("hidden");
        }
    },

    error(msg) {
        this.stopTimerTick();
        this.clearTimers();
        const statusText = document.getElementById("agentStatusText");
        const activeLabel = document.getElementById("agentActiveLabel");
        const notice = document.getElementById("flowEstNotice");
        if (statusText) statusText.textContent = `⚠️ Error: ${msg || "Agent workflow encountered an issue"}`;
        if (activeLabel) activeLabel.textContent = "Error";
        if (notice) {
            notice.classList.remove("completed");
            notice.innerHTML = `<span class="flow-est-icon">⚠️</span><span>Workflow halted: <strong>${msg || "Agent workflow encountered an issue"}</strong></span>`;
        }
    },

    clearTimers() {
        this.timers.forEach(t => clearTimeout(t));
        this.timers = [];
    },

    reset() {
        this.stopTimerTick();
        this.clearTimers();
        this.currentIndex = 0;
        this.totalStartTime = null;
        this.stepStartTimes = [null, null, null, null, null];
        this.stepDurations = [null, null, null, null, null];

        const trackFill = document.getElementById("stepperTrackFill");
        if (trackFill) trackFill.style.width = "0%";
        const totalTimerEl = document.getElementById("agentTotalTimer");
        if (totalTimerEl) totalTimerEl.textContent = "0.0s";
        const totalBadge = document.getElementById("agentTotalTimeBadge");
        if (totalBadge) totalBadge.classList.remove("completed");

        const notice = document.getElementById("flowEstNotice");
        if (notice) {
            notice.classList.remove("completed");
            notice.innerHTML = `<span class="flow-est-icon">⏳</span><span>Estimated total time: <strong>~70 seconds</strong> as 5 AI agents fetch live flight, hotel, and weather data. Please do not reload.</span>`;
        }

        for (let i = 1; i <= 5; i++) {
            const el = document.getElementById(`step-time-${i}`);
            if (el) {
                el.textContent = "--";
                el.classList.remove("active", "completed");
            }
        }
    }
};

function setPrompt(text) {
    document.getElementById("userInput").value = text;
}

function setLoading(isLoading) {
    const sendBtn = document.getElementById("sendBtn");
    const btnText = document.getElementById("btnText");
    const btnLoader = document.getElementById("btnLoader");

    sendBtn.disabled = isLoading;

    if (isLoading) {
        btnText.classList.add("hidden");
        btnLoader.classList.remove("hidden");
    } else {
        btnText.classList.remove("hidden");
        btnLoader.classList.add("hidden");
    }
}

function showError(message) {
    const errorBox = document.getElementById("errorBox");
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
}

function hideError() {
    const errorBox = document.getElementById("errorBox");
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
}

function showResult(answer, threadId) {
    latestAnswerMarkdown = answer;

    const resultSection = document.getElementById("resultSection");
    const resultBox = document.getElementById("resultBox");
    const threadInfo = document.getElementById("threadInfo");

    if (typeof marked !== "undefined") {
        resultBox.innerHTML = marked.parse(answer);
    } else {
        resultBox.innerText = answer;
    }

    threadInfo.textContent = `Thread ID: ${threadId}`;

    resultSection.classList.remove("hidden");

    resultSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

async function sendMessage() {
    hideError();

    const input = document.getElementById("userInput");
    const message = input.value.trim();

    if (!message) {
        showError("Please enter your travel request first.");
        return;
    }

    // Immediately show the workflow progress card
    const progressSection = document.getElementById("agentProgressSection");
    if (progressSection) {
        progressSection.classList.remove("hidden");
        progressSection.style.display = "block";
        progressSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    const resultSection = document.getElementById("resultSection");
    if (resultSection) {
        resultSection.classList.add("hidden");
    }

    setLoading(true);
    isGeneratingPlan = true;
    AgentWorkflowStepper.start();

    try {
        const response = await fetch("/api/travel/stream", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: message,
                thread_id: currentThreadId
            })
        });

        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalData = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop();

            for (const chunk of chunks) {
                const line = chunk.trim();
                if (!line.startsWith("data:")) continue;

                const jsonStr = line.replace(/^data:\s*/, "");
                try {
                    const eventData = JSON.parse(jsonStr);

                    if (eventData.event === "node_start") {
                        AgentWorkflowStepper.activateNode(eventData.node);
                    } else if (eventData.event === "node_complete") {
                        AgentWorkflowStepper.completeNode(eventData.node);
                    } else if (eventData.event === "complete") {
                        finalData = eventData;
                        currentThreadId = eventData.thread_id;
                        localStorage.setItem("travel_thread_id", currentThreadId);
                        AgentWorkflowStepper.complete();
                        setTimeout(() => {
                            showResult(eventData.answer, eventData.thread_id);
                        }, 500);
                    } else if (eventData.event === "error") {
                        throw new Error(eventData.error || "Agent execution failed.");
                    }
                } catch (err) {
                    console.error("Stream event parse error:", err);
                }
            }
        }

        if (!finalData) {
            const fallbackRes = await fetch("/api/travel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: message, thread_id: currentThreadId })
            });
            const data = await fallbackRes.json();
            if (data.success) {
                currentThreadId = data.thread_id;
                localStorage.setItem("travel_thread_id", currentThreadId);
                AgentWorkflowStepper.complete();
                setTimeout(() => {
                    showResult(data.answer, data.thread_id);
                }, 500);
            }
        }

    } catch (error) {
        console.warn("Streaming issue, falling back to standard API:", error);
        try {
            const fallbackRes = await fetch("/api/travel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: message, thread_id: currentThreadId })
            });
            const data = await fallbackRes.json();
            if (data.success) {
                currentThreadId = data.thread_id;
                localStorage.setItem("travel_thread_id", currentThreadId);
                AgentWorkflowStepper.complete();
                setTimeout(() => {
                    showResult(data.answer, data.thread_id);
                }, 500);
            } else {
                throw new Error(data.error || "Server failed to process request.");
            }
        } catch (fbErr) {
            AgentWorkflowStepper.error(fbErr.message);
            showError(fbErr.message);
        }
    } finally {
        isGeneratingPlan = false;
        setLoading(false);
    }
}

function copyResult() {
    const resultBox = document.getElementById("resultBox");
    const text = resultBox.innerText;

    if (!text) {
        return;
    }

    navigator.clipboard.writeText(text)
        .then(() => {
            const copyBtn = document.querySelector(".copy-btn");
            const oldText = copyBtn.textContent;

            copyBtn.textContent = "Copied!";

            setTimeout(() => {
                copyBtn.textContent = oldText;
            }, 1400);
        })
        .catch(() => {
            showError("Could not copy result.");
        });
}

function downloadPDF() {
    const pdfContent = document.getElementById("pdfContent");

    if (!latestAnswerMarkdown || !pdfContent) {
        showError("No travel plan available to download.");
        return;
    }

    const downloadBtn = document.querySelector(".download-btn");
    const oldText = downloadBtn.textContent;

    downloadBtn.textContent = "Preparing PDF...";
    downloadBtn.disabled = true;

    const options = {
        margin: 0.5,
        filename: "ai-travel-plan.pdf",
        image: {
            type: "jpeg",
            quality: 0.98
        },
        html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff"
        },
        jsPDF: {
            unit: "in",
            format: "a4",
            orientation: "portrait"
        },
        pagebreak: {
            mode: ["avoid-all", "css", "legacy"]
        }
    };

    html2pdf()
        .set(options)
        .from(pdfContent)
        .save()
        .then(() => {
            downloadBtn.textContent = oldText;
            downloadBtn.disabled = false;
        })
        .catch(() => {
            downloadBtn.textContent = oldText;
            downloadBtn.disabled = false;
            showError("Could not download PDF.");
        });
}

document.addEventListener("keydown", function(event) {
    if (event.ctrlKey && event.key === "Enter") {
        sendMessage();
    }
});