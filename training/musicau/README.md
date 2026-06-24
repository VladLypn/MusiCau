# MusiCau Training Pipeline

This scaffold trains the optional second-stage recognizer. The browser DSP system is already usable without this model; the model improves ambiguous chords, noisy microphones, unusual guitars, and alternate tunings.

## Dataset Layout

```text
dataset/
  clean/
    notes/*.wav
    chords/*.wav
  noisy/
    notes/*.wav
    chords/*.wav
  metadata.csv
```

`metadata.csv` columns:

```text
path,label,type,root,quality,tuning,guitar,split
```

`type` is `note` or `chord`. `split` is `train`, `val`, or `test`.

## Commands

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r training/musicau/requirements.txt
python training/musicau/train.py --metadata dataset/metadata.csv --audio-root dataset --model cnn
```

Supported model values are `cnn`, `crnn`, and `transformer`.
