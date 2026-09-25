# config-value.sh -- sourced by run.sh: cfg KEY FILE prints KEY's value from a combination's
# config.sh (or a reference stack's stack.env) the way the shell would read it: the text inside
# quotes, or else the first word, and never a trailing comment. `CONTEXT_LIMIT=131072   # note`
# once reached drive.py as "131072   # note" and the run died on --context-limit.
cfg() {
  sed -n -E \
    -e "s/^$1=\"([^\"]*)\".*/\1/p" -e t \
    -e "s/^$1='([^']*)'.*/\1/p" -e t \
    -e "s/^$1=([^[:space:]#]*).*/\1/p" "$2" | head -1
}
