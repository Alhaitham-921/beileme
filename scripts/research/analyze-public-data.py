"""Reproducible offline pilot. Reads public files only; never connects to app databases.
Requires numpy, pandas, openpyxl. No scipy or paid service needed.
"""
import argparse
import hashlib
import json
import platform
from pathlib import Path

import numpy as np
import pandas as pd

parser = argparse.ArgumentParser()
parser.add_argument('--directory', default='output/public-research-20261119')
args = parser.parse_args()
root = Path(args.directory)
seed = 20261119


def interval(values, repetitions=5000):
    """Paired participant bootstrap; never treats each vocabulary item as independent."""
    values = np.asarray(values, dtype=float)
    rng = np.random.default_rng(seed)
    means = values[rng.integers(0, len(values), (repetitions, len(values)))].mean(axis=1)
    return np.quantile(means, [.025, .975]).tolist()


def image_experiments():
    results = []
    inventory = json.loads((root / 'image-study-osf-inventory.json').read_text(encoding='utf8'))
    expected_n = {1: 58, 2: 123, 3: 47, 4: 113}
    for number in range(1, 5):
        filename = root / f'osf-Experiment-{number}-Data.xlsx'
        source = next(f for f in inventory['files'] if f['attributes']['name'] == f'Experiment {number} Data.xlsx')
        assert hashlib.sha256(filename.read_bytes()).hexdigest() == source['attributes']['extra']['hashes']['sha256'], 'Source file integrity failed'
        data = pd.read_excel(filename, sheet_name=f'ptl2exp{number}')
        assert len(data) == expected_n[number]
        identifiers = ['COND', 'ID'] if 'COND' in data else ['ID']
        assert not data.duplicated(identifiers).any(), 'Duplicate participant identity within study condition'
        groups = [('all', data)]
        if 'COND' in data:
            groups.extend((str(k), v) for k, v in data.groupby('COND'))
        for group_name, group in groups:
            for task in ['RECOG', 'RECALL']:
                pair = group[[task + '_P', task + '_R']].dropna()
                assert len(pair) == len(group), 'Unexpected incomplete pair'
                assert pair.ge(0).all().all() and pair.le(1).all().all()
                pretest, reading = pair.iloc[:, 0].to_numpy(), pair.iloc[:, 1].to_numpy()
                diff = pretest - reading
                results.append({
                    'experiment': number, 'group': group_name,
                    'task': 'recognition' if task == 'RECOG' else 'cued_recall',
                    'n': len(pair), 'pretest': float(pretest.mean()), 'reading': float(reading.mean()),
                    'differencePercentagePoints': float(diff.mean() * 100),
                    'bootstrap95PercentagePoints': [x * 100 for x in interval(diff)],
                    'pairedT': float(diff.mean() / (diff.std(ddof=1) / np.sqrt(len(pair)))),
                    'dz': float(diff.mean() / diff.std(ddof=1)),
                    'dAv': float(diff.mean() / np.sqrt((pretest.var(ddof=1) + reading.var(ddof=1)) / 2)),
                    'source': filename.name, 'sheet': f'ptl2exp{number}',
                })
    published_t = {(1, 'all', 'recognition'): 4.73, (1, 'all', 'cued_recall'): 3.46,
                   (2, 'Blocking', 'recognition'): 5.37, (2, 'Blocking', 'cued_recall'): 3.91,
                   (2, 'Intermixing', 'recognition'): 4.95, (2, 'Intermixing', 'cued_recall'): 2.70,
                   (3, 'all', 'recognition'): 1.39, (3, 'all', 'cued_recall'): 3.86,
                   (4, 'Blocking', 'recognition'): 2.26, (4, 'Blocking', 'cued_recall'): 3.04,
                   (4, 'Intermixing', 'recognition'): 2.67, (4, 'Intermixing', 'cued_recall'): 2.89}
    matched = []
    for item in results:
        key = (item['experiment'], item['group'], item['task'])
        if key in published_t:
            difference = abs(item['pairedT'] - published_t[key])
            assert difference < .0051, f'Published paired t mismatch: {key}'
            matched.append(difference)
    assert len(matched) == 12
    return {'participantsAcrossFourExperiments': sum(expected_n.values()), 'results': results,
            'publishedPairedTReproduced': len(matched), 'maxDifferenceFromRoundedPublishedT': max(matched),
            'method': 'Original main outcome sheets only; no CG/ICG sensitivity sheets or metacognition mixed into outcomes. Paired participant bootstrap, 5000 draws, fixed seed. Subgroup rows and all rows overlap and must not be added.',
            'limits': 'Immediate post-distractor outcomes for concrete Spanish nouns, not 7/30-day retention, abstract English words, or this product. dAv and dz are explicitly defined and not substituted for an unspecified published d.'}


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -35, 35)))


def logistic_fit(x, y, ridge):
    # Fractional-label cross entropy, equal weight per lesson/lexeme trace.
    # IRLS solves a small convex model; regularization choice uses validation only.
    weights = np.zeros(x.shape[1])
    penalty = np.eye(x.shape[1]) * ridge
    penalty[0, 0] = 0
    for _ in range(60):
        pred = sigmoid(x @ weights)
        gradient = x.T @ (pred - y) + penalty @ weights
        hessian = x.T @ ((pred * (1 - pred))[:, None] * x) + penalty + np.eye(x.shape[1]) * 1e-8
        step = np.linalg.solve(hessian, gradient)
        # Backtracking protects against an oversized Newton step.
        old_loss = np.logaddexp(0, x @ weights).sum() - y @ (x @ weights) + .5 * weights @ penalty @ weights
        scale = 1.
        while scale > 1e-6:
            candidate = weights - scale * step
            z = x @ candidate
            new_loss = np.logaddexp(0, z).sum() - y @ z + .5 * candidate @ penalty @ candidate
            if new_loss <= old_loss:
                break
            scale *= .5
        weights = candidate
        if np.max(np.abs(scale * step)) < 1e-7:
            break
    return weights


def metrics(y, pred):
    p = np.clip(pred, 1e-7, 1 - 1e-7)
    return {'mae': float(np.abs(y - p).mean()), 'rmse': float(np.sqrt(((y - p) ** 2).mean())),
            'crossEntropy': float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())}


def duolingo_pilot():
    filename = root / 'duolingo-prefix-sample.csv.gz'
    data = pd.read_csv(filename)
    provenance = json.loads((root / 'sample-provenance.json').read_text())
    valid = data[['p_recall', 'timestamp', 'delta', 'history_seen', 'history_correct', 'session_seen', 'session_correct']].notna().all(axis=1)
    valid &= data.p_recall.between(0, 1) & data.delta.ge(0) & data.history_seen.ge(data.history_correct) & data.history_correct.ge(0)
    valid &= data.session_seen.gt(0) & data.session_correct.between(0, data.session_seen)
    valid &= np.isclose(data.p_recall, data.session_correct / data.session_seen)
    assert valid.all(), 'Investigate invalid records before analysis; no silent filtering'
    assert not data.duplicated().any(), 'Duplicate source rows'
    bucket = data.user_id.map(lambda user: int(hashlib.sha256(str(user).encode()).hexdigest()[:8], 16) % 10)
    # Time order AND disjoint learners. Cutoffs decided before fitting and scoring.
    cutoff_train, cutoff_test = np.quantile(data.timestamp, [.70, .85])
    masks = {'train': (bucket < 8) & (data.timestamp <= cutoff_train),
             'validation': (bucket < 8) & (data.timestamp > cutoff_train) & (data.timestamp <= cutoff_test),
             'test': (bucket >= 8) & (data.timestamp > cutoff_test)}
    train, validation, test = [data.loc[masks[k]] for k in ['train', 'validation', 'test']]
    assert len(test) >= 100 and test.user_id.nunique() >= 10
    assert not set(train.user_id) & set(test.user_id)
    assert not set(validation.user_id) & set(test.user_id)
    assert train.timestamp.max() < validation.timestamp.min() <= validation.timestamp.max() < test.timestamp.min()
    languages = sorted(train.learning_language.unique())
    def features(frame, with_history):
        columns = [np.log1p(frame.delta.to_numpy() / 86400)]
        if with_history:
            columns.extend([np.log1p(frame.history_correct.to_numpy()),
                            np.log1p((frame.history_seen - frame.history_correct).to_numpy()),
                            (frame.history_correct.to_numpy() + 2) / (frame.history_seen.to_numpy() + 4)])
        columns.extend((frame.learning_language == lang).to_numpy().astype(float) for lang in languages[1:])
        return np.column_stack(columns)
    predictions = {'training_mean': np.full(len(test), train.p_recall.mean()),
                   'historical_smoothed_rate': (test.history_correct.to_numpy() + 2) / (test.history_seen.to_numpy() + 4)}
    models = {}
    for name, history in [('time_language_logistic', False), ('history_time_language_logistic', True)]:
        train_raw = features(train, history)
        mean, std = train_raw.mean(axis=0), np.maximum(train_raw.std(axis=0), 1e-8)
        def matrix(frame):
            raw = features(frame, history)
            return np.column_stack([np.ones(len(frame)), (raw - mean) / std])
        x_train, x_val, x_test = [matrix(f) for f in [train, validation, test]]
        candidates = []
        for ridge in [.1, 1., 10.]:
            weights = logistic_fit(x_train, train.p_recall.to_numpy(), ridge)
            val_metrics = metrics(validation.p_recall.to_numpy(), sigmoid(x_val @ weights))
            candidates.append((val_metrics['crossEntropy'], ridge, weights))
        _, ridge, weights = min(candidates, key=lambda item: item[0])
        predictions[name] = sigmoid(x_test @ weights)
        models[name] = {'ridgeSelectedOnValidation': ridge, 'weights': weights.tolist(), 'trainingMean': mean.tolist(), 'trainingStd': std.tolist(), 'languages': languages}
    target = test.p_recall.to_numpy()
    scores = {name: metrics(target, p) for name, p in predictions.items()}
    # Cluster by learner; target here is equal-learner MAE, separately labeled from row MAE above.
    abs_improvement = np.abs(target - predictions['time_language_logistic']) - np.abs(target - predictions['history_time_language_logistic'])
    per_user = pd.DataFrame({'user': test.user_id.to_numpy(), 'improvement': abs_improvement}).groupby('user').improvement.mean().to_numpy()
    calibration = []
    p = predictions['history_time_language_logistic']
    for lo in np.arange(0., 1., .1):
        select = (p >= lo) & ((p < lo + .1) if lo < .9 else (p <= 1))
        if select.any():
            calibration.append({'predictedBinLower': float(lo), 'n': int(select.sum()), 'meanPredicted': float(p[select].mean()), 'meanObserved': float(target[select].mean())})
    return {'provenance': provenance, 'validRows': len(data), 'users': int(data.user_id.nunique()),
            'firstTimestampUTC': str(pd.to_datetime(data.timestamp.min(), unit='s', utc=True)),
            'lastTimestampUTC': str(pd.to_datetime(data.timestamp.max(), unit='s', utc=True)),
            'languageCounts': data.learning_language.value_counts().to_dict(),
            'split': {name: {'rows': int(mask.sum()), 'users': int(data.loc[mask, 'user_id'].nunique()),
                             'firstTimestamp': int(data.loc[mask, 'timestamp'].min()), 'lastTimestamp': int(data.loc[mask, 'timestamp'].max())} for name, mask in masks.items()},
            'excludedForSplit': int(len(data) - sum(mask.sum() for mask in masks.values())),
            'testScores': scores, 'models': models, 'calibration': calibration,
            'equalLearnerMAEImprovementWithHistory': float(per_user.mean()),
            'equalLearnerMAEImprovement95Bootstrap': interval(per_user),
            'method': 'Fixed SHA256 user bucket; train/validation in first 70%/next 15% timestamps for 80% users, test in last 15% timestamps for disjoint 20% users. Only pre-session history, time delta, learning language are features. Current-session answers supply labels only. Equal-row fractional-label cross entropy. Ridge .1/1/10 chosen on validation. This is an original pilot, not a reproduction of published HLR scores.',
            'limits': 'Only contiguous file prefix covering a few hours. Long historical deltas do not turn this into long-term sampled coverage. No causal inference; no app SM-2 efficacy or A/B equating conclusion. No AUC after arbitrary binarization of fractional outcomes. No app scheduler probability invented from its interval.'}


output = {'seed': seed, 'environment': {'python': platform.python_version(), 'numpy': np.__version__, 'pandas': pd.__version__},
          'imageStudy': image_experiments(), 'duolingo': duolingo_pilot()}
(root / 'offline-results.json').write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf8')
pd.DataFrame(output['imageStudy']['results']).to_csv(root / 'image-study-reproduction.csv', index=False)
print(json.dumps({'imageParticipants': output['imageStudy']['participantsAcrossFourExperiments'],
                  'imageResults': [r for r in output['imageStudy']['results'] if r['group'] == 'all'],
                  'duolingoSplit': output['duolingo']['split'], 'duolingoScores': output['duolingo']['testScores'],
                  'learnerMAEImprovement': output['duolingo']['equalLearnerMAEImprovementWithHistory'],
                  'learnerMAEImprovement95': output['duolingo']['equalLearnerMAEImprovement95Bootstrap']}, ensure_ascii=False, indent=2))
