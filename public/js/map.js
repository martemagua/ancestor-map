// The tree canvas. This file is the M4 milestone — the generational layout,
// the Zeit axis, gestures and hulls land here next. Until then the shell
// boots against these no-op exports so every other tab already works.
let mode = 'gen';
let physics = true;
let allEdges = false;

export function initMap() {}
export function draw() {}
export function reheat() {}
export function fitView() {}
export function focusPerson() {}
export function shake() {}
export function setHighlight() {}
export const setPhysics = on => { physics = on; return physics; };
export const physicsEnabled = () => physics;
export const setAllEdges = on => { allEdges = on; };
export const allEdgesShown = () => allEdges;
export const setLayoutMode = m => { mode = m === 'zeit' ? 'zeit' : 'gen'; };
export const layoutMode = () => mode;
