//! Provokes gufo issue 631: on 0.17.0 a long request restoring a cached prefix from RAM, beside a short one,
//! froze every slot ("wedge"). The reporter's recipe is a conversation that grows by about 20k novel tokens per
//! attempt; each attempt sends the whole conversation plus a question (the long lane) and a two-word question
//! (the short lane) at once, and polls `/slots` for a processing slot whose counters stop moving.

pub mod attempt;
pub mod slots;
pub mod text;
