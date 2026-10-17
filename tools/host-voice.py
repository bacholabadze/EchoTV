#!/usr/bin/env python3
"""Offline host voice for ECHO broadcasts (Piper, en_US-ljspeech-high, same voice as the pilot).

Reads {"lines":[{"id":..., "text":...}], "outDir": ...} on stdin and writes <outDir>/<id>-<hash>.mp3.
Prints JSON {id: {audio, duration, cues, captions}} on stdout. Cues come from Piper's phoneme/audio
alignments mapped to the avatar's viseme keys; the mapping is approximate, not measured lip-sync.
"""
import hashlib, json, os, re, subprocess, sys, wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = os.path.join(ROOT, "voices", "en_US-ljspeech-high.onnx")

# IPA (espeak-ng) phoneme -> viseme key used by the studio rig (viseme_<key>).
VISEME = {}
for keys, v in [("pbm", "PP"), ("fv", "FF"), ("θð", "TH"), ("tdɾ", "DD"), ("kgŋ", "kk"), ("ʃʒ", "CH"), ("sz", "SS"),
                ("nlɫ", "nn"), ("ɹr", "RR"), ("aɑæʌɐ", "aa"), ("eɛə", "E"), ("iɪj", "I"), ("oɔɒ", "O"), ("uʊw", "U")]:
    for k in keys:
        VISEME[k] = v
VISEME.update({"ɚ": "RR", "ɝ": "RR", "h": None, "ʔ": None})


def synthesize(voice, text, out_mp3):
    from piper import SynthesisConfig
    cues, captions, at, pcm, rate = [], [], 0, b"", 22050
    for sentence in re.findall(r"[^.!?]+[.!?]*", text):
        if not sentence.strip():
            continue
        start = at
        for chunk in voice.synthesize(sentence.strip(), syn_config=SynthesisConfig(), include_alignments=True):
            rate = chunk.sample_rate
            for a in chunk.phoneme_alignments or []:
                key, t0, t1 = VISEME.get(a.phoneme), at / rate, (at + a.num_samples) / rate
                if cues and cues[-1]["key"] == key and abs(cues[-1]["end"] - round(t0, 4)) < 1e-3:
                    cues[-1]["end"] = round(t1, 4)
                else:
                    cues.append({"start": round(t0, 4), "end": round(t1, 4), "key": key})
                at += a.num_samples
            if not chunk.phoneme_alignments:
                at += len(chunk.audio_int16_array)
            pcm += chunk.audio_int16_bytes
        at = len(pcm) // 2  # keep the cue clock on the actual sample count
        captions.append({"start": round(start / rate, 4), "end": round(at / rate, 4), "text": sentence.strip()})
    wav_path = out_mp3[:-4] + ".wav"
    with wave.open(wav_path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-q:a", "4", out_mp3], check=True)
    os.remove(wav_path)
    return {"duration": round(len(pcm) / 2 / rate, 4), "cues": cues, "captions": captions}


def main():
    request = json.load(sys.stdin)
    from piper import PiperVoice
    voice = PiperVoice.load(MODEL, include_alignments=True)
    os.makedirs(request["outDir"], exist_ok=True)
    result = {}
    for line in request["lines"]:
        digest = hashlib.sha256(line["text"].encode()).hexdigest()[:12]
        name = f"{line['id']}-{digest}.mp3"
        path, meta_path = os.path.join(request["outDir"], name), os.path.join(request["outDir"], name + ".json")
        if os.path.exists(path) and os.path.exists(meta_path):
            meta = json.load(open(meta_path))
        else:
            meta = synthesize(voice, line["text"], path)
            json.dump(meta, open(meta_path, "w"))
        result[line["id"]] = {"file": name, "text": line["text"], **meta}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
