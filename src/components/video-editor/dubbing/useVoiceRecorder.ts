import { useCallback, useEffect, useRef, useState } from "react";

export interface UseVoiceRecorderOptions {
	maxDurationSec?: number;
	onComplete?: (buffer: Uint8Array, mimeType: string) => void;
}

export function useVoiceRecorder({
	maxDurationSec = 8,
	onComplete,
}: UseVoiceRecorderOptions = {}) {
	const [isRecording, setIsRecording] = useState(false);
	const [durationSec, setDurationSec] = useState(0);
	const [volume, setVolume] = useState(0); // 0 to 1 normalized
	const [error, setError] = useState<string | null>(null);

	const mediaStreamRef = useRef<MediaStream | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const audioContextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const stopPromiseResolverRef = useRef<((buffer: Uint8Array | null) => void) | null>(null);

	// Cleanup all active streams and audio context
	const cleanup = useCallback(() => {
		if (timerIntervalRef.current) {
			clearInterval(timerIntervalRef.current);
			timerIntervalRef.current = null;
		}
		if (animationFrameRef.current) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}
		if (mediaStreamRef.current) {
			for (const track of mediaStreamRef.current.getTracks()) {
				track.stop();
			}
			mediaStreamRef.current = null;
		}
		if (audioContextRef.current && audioContextRef.current.state !== "closed") {
			void audioContextRef.current.close().catch(() => {});
			audioContextRef.current = null;
		}
		analyserRef.current = null;
		mediaRecorderRef.current = null;
		setIsRecording(false);
		setVolume(0);
	}, []);

	// Stop recording
	const stopRecording = useCallback((): Promise<Uint8Array | null> => {
		return new Promise((resolve) => {
			if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
				cleanup();
				resolve(null);
				return;
			}

			stopPromiseResolverRef.current = resolve;
			try {
				mediaRecorderRef.current.stop();
			} catch (err) {
				console.error("[useVoiceRecorder] Error stopping recorder:", err);
				cleanup();
				resolve(null);
			}
		});
	}, [cleanup]);

	// Cancel recording without saving
	const cancelRecording = useCallback(() => {
		stopPromiseResolverRef.current = null;
		audioChunksRef.current = [];
		if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
			try {
				mediaRecorderRef.current.stop();
			} catch {}
		}
		cleanup();
		setDurationSec(0);
		setError(null);
	}, [cleanup]);

	// Start recording
	const startRecording = useCallback(async () => {
		cleanup();
		setError(null);
		setDurationSec(0);
		audioChunksRef.current = [];

		try {
			if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
				throw new Error("Microphone access is not supported on this platform.");
			}

			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			});
			mediaStreamRef.current = stream;

			// Setup Web Audio Analyser for VU volume meter
			const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			if (AudioContextClass) {
				const ctx = new AudioContextClass();
				audioContextRef.current = ctx;
				const source = ctx.createMediaStreamSource(stream);
				const analyser = ctx.createAnalyser();
				analyser.fftSize = 256;
				source.connect(analyser);
				analyserRef.current = analyser;

				const dataArray = new Uint8Array(analyser.frequencyBinCount);
				const updateVolume = () => {
					if (!analyserRef.current) return;
					analyserRef.current.getByteFrequencyData(dataArray);
					let sum = 0;
					for (let i = 0; i < dataArray.length; i++) {
						sum += dataArray[i];
					}
					const average = sum / dataArray.length;
					const normalized = Math.min(1, Math.max(0, average / 128));
					setVolume(normalized);
					animationFrameRef.current = requestAnimationFrame(updateVolume);
				};
				updateVolume();
			}

			// Setup MediaRecorder
			let mimeType = "audio/webm;codecs=opus";
			if (typeof MediaRecorder !== "undefined") {
				if (!MediaRecorder.isTypeSupported(mimeType)) {
					mimeType = MediaRecorder.isTypeSupported("audio/webm")
						? "audio/webm"
						: MediaRecorder.isTypeSupported("audio/mp4")
							? "audio/mp4"
							: "";
				}
			}

			const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
			mediaRecorderRef.current = recorder;

			recorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) {
					audioChunksRef.current.push(event.data);
				}
			};

			recorder.onstop = async () => {
				const recordedMime = recorder.mimeType || "audio/webm";
				const blob = new Blob(audioChunksRef.current, { type: recordedMime });
				cleanup();

				if (blob.size === 0) {
					stopPromiseResolverRef.current?.(null);
					stopPromiseResolverRef.current = null;
					return;
				}

				try {
					const arrayBuffer = await blob.arrayBuffer();
					const uint8Array = new Uint8Array(arrayBuffer);
					onComplete?.(uint8Array, recordedMime);
					stopPromiseResolverRef.current?.(uint8Array);
				} catch (convErr) {
					console.error("[useVoiceRecorder] Failed to convert recorded blob:", convErr);
					stopPromiseResolverRef.current?.(null);
				} finally {
					stopPromiseResolverRef.current = null;
				}
			};

			recorder.start(200); // 200ms timeslices
			setIsRecording(true);

			// Track elapsed seconds
			const startTime = Date.now();
			timerIntervalRef.current = setInterval(() => {
				const elapsed = Math.floor((Date.now() - startTime) / 1000);
				setDurationSec(elapsed);

				if (elapsed >= maxDurationSec) {
					void stopRecording();
				}
			}, 250);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error("[useVoiceRecorder] Failed to start microphone:", err);
			setError(errMsg.includes("Permission") || errMsg.includes("NotAllowed")
				? "Microphone access was denied. Please allow microphone permissions."
				: errMsg);
			cleanup();
		}
	}, [cleanup, maxDurationSec, onComplete, stopRecording]);

	const reset = useCallback(() => {
		cancelRecording();
		setDurationSec(0);
		setError(null);
	}, [cancelRecording]);

	useEffect(() => {
		return () => {
			cleanup();
		};
	}, [cleanup]);

	return {
		isRecording,
		durationSec,
		volume,
		error,
		startRecording,
		stopRecording,
		cancelRecording,
		reset,
	};
}
