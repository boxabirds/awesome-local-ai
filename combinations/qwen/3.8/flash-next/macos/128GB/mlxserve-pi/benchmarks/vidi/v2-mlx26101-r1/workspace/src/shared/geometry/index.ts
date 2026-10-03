// Geometry for the board (story 10 gathered it into a folder).
//
// `./geometry` is the box arithmetic every story so far uses; `./polyline` measures
// distance to a line (an arrow today, a freehand stroke in story 11); and
// `./connector-geometry` decides where an arrow attaches. Each can be imported by
// its own path — this barrel is here so `shared/geometry` keeps meaning "the board's
// geometry".

export * from './geometry';
export * from './polyline';
export * from './connector-geometry';
