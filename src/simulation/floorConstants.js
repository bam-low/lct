// FLOOR живёт в отдельном листовом модуле без импортов, чтобы shape/shapeTypes.js
// и shape/shapeGeometry.js могли использовать его на верхнем уровне модуля, не
// создавая цикл импортов с layout.js (который сам зависит от shapeGeometry.js
// для computeGateClusters/boundingBoxOf в computeLayout).
export const FLOOR = 100;
