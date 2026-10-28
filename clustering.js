window.Clustering = (() => {
  function averageDifference(left, right) {
    return left.reduce((total, value, index) => total + Math.abs(value - right[index]), 0) / left.length;
  }

  function similarity(left, right) {
    return Math.round((1 - averageDifference(left, right) / 4) * 100);
  }

  function closestResponses(response, pool) {
    return pool.filter((other) => other.id !== response.id).map((other) => ({ response: other, score: similarity(response.answers, other.answers) }));
  }

  function clusterResponses(items) {
    if (items.length < 2) return items.map(() => 0);
    const clusterCount = Math.min(5, Math.max(1, Math.floor(Math.sqrt(items.length / 2))));
    const centers = [items[0].answers.map(Number)];
    while (centers.length < clusterCount) {
      let farthest = items[0].answers;
      let farthestDistance = -1;
      for (const item of items) {
        const nearest = Math.min(...centers.map((center) => averageDifference(center, item.answers)));
        if (nearest > farthestDistance) { farthest = item.answers; farthestDistance = nearest; }
      }
      centers.push(farthest.map(Number));
    }
    let assignments = items.map(() => 0);
    for (let iteration = 0; iteration < 16; iteration += 1) {
      assignments = items.map((item) => {
        let nearestIndex = 0;
        let nearestDistance = Infinity;
        centers.forEach((center, index) => {
          const distance = averageDifference(center, item.answers);
          if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
        });
        return nearestIndex;
      });
      centers.forEach((_, clusterIndex) => {
        const members = items.filter((__, index) => assignments[index] === clusterIndex);
        if (!members.length) return;
        centers[clusterIndex] = centers[clusterIndex].map((__, answerIndex) => members.reduce((sum, item) => sum + Number(item.answers[answerIndex]), 0) / members.length);
      });
    }
    return assignments;
  }

  function dominantComponent(matrix, seed, previous = []) {
    let vector = seed.map(Number);
    const normalize = (values) => {
      const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
      return length < 1e-10 ? null : values.map((value) => value / length);
    };
    vector = normalize(vector);
    if (!vector) return Array(seed.length).fill(0);
    for (let iteration = 0; iteration < 80; iteration += 1) {
      let next = matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
      for (const component of previous) {
        const projection = next.reduce((sum, value, index) => sum + value * component[index], 0);
        next = next.map((value, index) => value - projection * component[index]);
      }
      const normalized = normalize(next);
      if (!normalized) return Array(seed.length).fill(0);
      vector = normalized;
    }
    return vector;
  }

  function projectResponses(items) {
    if (!items.length) return { points: [], firstPercent: 0, secondPercent: 0 };
    const dimensions = items[0].answers.length;
    const means = Array.from({ length: dimensions }, (_, answerIndex) => items.reduce((sum, item) => sum + Number(item.answers[answerIndex]), 0) / items.length);
    const centered = items.map((item) => item.answers.map((answer, answerIndex) => Number(answer) - means[answerIndex]));
    const covariance = Array.from({ length: dimensions }, () => Array(dimensions).fill(0));
    for (let left = 0; left < dimensions; left += 1) {
      for (let right = left; right < dimensions; right += 1) {
        const value = centered.reduce((sum, row) => sum + row[left] * row[right], 0) / items.length;
        covariance[left][right] = value;
        covariance[right][left] = value;
      }
    }
    const first = dominantComponent(covariance, Array.from({ length: dimensions }, (_, index) => 1 / (index + 1)));
    const second = dominantComponent(covariance, Array.from({ length: dimensions }, (_, index) => Math.sin(index + 1)), [first]);
    const eigenvalue = (component) => component.reduce((sum, value, index) => sum + value * covariance[index].reduce((rowSum, entry, column) => rowSum + entry * component[column], 0), 0);
    const firstVariance = Math.max(0, eigenvalue(first));
    const secondVariance = Math.max(0, eigenvalue(second));
    const totalVariance = covariance.reduce((sum, row, index) => sum + row[index], 0) || 1;
    const points = centered.map((row) => ({
      x: row.reduce((sum, value, index) => sum + value * first[index], 0),
      y: row.reduce((sum, value, index) => sum + value * second[index], 0),
    }));
    const maxX = Math.max(...points.map((point) => Math.abs(point.x))) || 1;
    const maxY = Math.max(...points.map((point) => Math.abs(point.y))) || 1;
    return {
      points: points.map((point) => ({ x: 500 + point.x / maxX * 430, y: 215 - point.y / maxY * 165 })),
      firstPercent: Math.round(firstVariance / totalVariance * 100),
      secondPercent: Math.round(secondVariance / totalVariance * 100),
    };
  }

  return { averageDifference, similarity, closestResponses, clusterResponses, projectResponses };
})();