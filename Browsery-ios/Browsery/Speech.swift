import AVFoundation
import Speech

/// Tap to talk: on-device speech recognition for Hey Groq and voice search.
final class Listener: ObservableObject {
    @Published var listening = false
    @Published var heard = ""
    @Published var problem: String?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var delivered = false
    private var onDone: ((String) -> Void)?

    func toggle(_ done: @escaping (String) -> Void) {
        if listening { finish() } else { start(done) }
    }

    func start(_ done: @escaping (String) -> Void) {
        problem = nil
        onDone = done
        SFSpeechRecognizer.requestAuthorization { status in
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard status == .authorized, granted else {
                        self.problem = "Allow the microphone and speech recognition for Browsery in the Settings app to talk to Hey Groq."
                        return
                    }
                    self.begin()
                }
            }
        }
    }

    private func begin() {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            problem = "Speech recognition isn't available right now."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                problem = "Browsery can't hear a microphone on this device."
                return
            }
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
            engine.prepare()
            try engine.start()

            request = req
            heard = ""
            delivered = false
            listening = true
            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if let result {
                        self.heard = result.bestTranscription.formattedString
                        if result.isFinal { self.finish(); self.deliver() }
                    }
                    if error != nil { self.finish(); self.deliver() }
                }
            }
            // Stop by itself after a short while, like a voice search should.
            DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
                if self?.listening == true { self?.finish() }
            }
        } catch {
            problem = "Couldn't start the microphone."
            finish()
        }
    }

    /// Stops listening; the final result arrives a moment later and is delivered once.
    func finish() {
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in self?.deliver() }
    }

    private func deliver() {
        guard !delivered else { return }
        let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        delivered = true
        task?.cancel()
        task = nil
        request = nil
        onDone?(text)
    }
}
