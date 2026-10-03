// Geometry for the board (story 10 gathered it into a folder).
//
// `./geometry` is the box arithmetic every story so far uses; `./polyline` measures
// distance to a line (an arrow today, a freehand stroke in story 11); `./simplify` thins a path a
// hand drew into the line that means the same thing; and `./connector-geometry` decides where an
// arrow attaches. Each can be imported by
// its own path — this barrel is here so `shared/geometry` keeps meaning "the board's
// geometry".

export * from './geometry';
export * from './polyline';
export * from './simplify';
export * from './connector-geometry';
