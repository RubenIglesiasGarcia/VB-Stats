"""Reproducible point-in-time contact detection evaluation.

Ground-truth timestamps must be annotated independently of model proposals.
Greedy nearest-time matching prevents duplicate predictions becoming true positives.
"""
from __future__ import annotations
from dataclasses import dataclass
from statistics import median

@dataclass(frozen=True)
class ContactMetrics:
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: float | None
    recall: float | None
    f1: float | None
    median_error_seconds: float | None

    def to_dict(self) -> dict:
        return dict(self.__dict__)


def evaluate_contacts(predictions: list[float], ground_truth: list[float], tolerance: float=.35) -> ContactMetrics:
    if tolerance <= 0 or tolerance > 5:
        raise ValueError('La tolerancia debe ser mayor que cero y no superar cinco segundos.')
    if any(not 0 <= n < float('inf') for n in predictions+ground_truth):
        raise ValueError('Los tiempos deben ser finitos y positivos.')
    # Maximum-cardinality matching in temporal order: avoids penalising valid
    # detections when one proposal is close to more than one true touch.
    # O(N log N) overall, rather than materialising every possible pairing.
    ordered_p=sorted(predictions)
    ordered_g=sorted(ground_truth)
    i=j=0
    diffs=[]
    while i<len(ordered_p) and j<len(ordered_g):
        delta=ordered_p[i]-ordered_g[j]
        if abs(delta)<=tolerance:
            diffs.append(abs(delta));i+=1;j+=1
        elif delta < -tolerance:i+=1
        else:j+=1
    tp=len(diffs);fp=len(predictions)-tp;fn=len(ground_truth)-tp
    precision=tp/(tp+fp) if tp+fp else None
    recall=tp/(tp+fn) if tp+fn else None
    f1=(2*precision*recall/(precision+recall)) if precision is not None and recall is not None and precision+recall else (0. if precision is not None and recall is not None else None)
    median_error=median(diffs) if diffs else None
    return ContactMetrics(tp,fp,fn,precision,recall,f1,median_error)
