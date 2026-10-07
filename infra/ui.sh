# The terminal interface of infra/plug-and-play.sh — sourced, not run. Numbered steps with a spinner
# and their time; the commands' output goes to a log file, whose last line shows under the step while
# it runs; a step that fails stops everything with its reason framed and the end of the log; a framed
# summary at the end. Two bars of # say where it is while a step runs: on the step's line, how many of
# the steps are done; under it, how far the command is when it says so (a percentage, « 3/12 »), and
# a block that goes back and forth when it does not: at work, how far unknown. Without a terminal (a
# pipe, a file) the same lines come plain, without the animation; NO_COLOR turns the colours off.
#
#   ui_init <steps> <log> [what]   once, before anything else; `what` heads the log
#   ui_step <title>            starts the next step
#   ui_task <label> <cmd…>     runs a command (or a function) into the log, spinner meanwhile; its exit
#                              status in UI_RC, and always returns 0: check it with ((UI_RC == 0)) || …
#   ui_run <label> <cmd…>      the same, stopping with a generic reason when it fails
#   ui_detail <text>           a word after the step's line, once done
#   ui_note <text>             a remark under the step (yellow !), repeated in the summary
#   ui_skip <text>             the step does nothing this time
#   ui_done                    ends the step: ✓, ! or –, and its time
#   ui_fail <reason>           stops everything: ✗, the reason framed, the end of the log
#   ui_box <colour> <title> <line…>   a framed block
# Steps run one after the other, in the script's own shell: no step inside another.

shopt -s extglob

ui_init() {
  UI_TOTAL=$1
  UI_LOG=${2:-$HOME/.local/share/sentinel-x/plug-and-play.log}
  UI_INDEX=0 UI_TITLE="" UI_PID="" UI_RC=0 UI_ACTIVE=false UI_KEEPALIVE=""
  UI_NOTES=() UI_ALL_NOTES=()
  UI_TTY=false
  [[ -t 1 ]] && UI_TTY=true
  local cols
  cols=$(tput cols 2>/dev/null || echo 80)
  [[ "$cols" =~ ^[0-9]+$ ]] || cols=80
  UI_COLS=$cols
  # The steps' lines stop here: their times line up, and a wide terminal does not spread them out.
  UI_WIDTH=$((cols - 2 < 66 ? cols - 2 : 66))
  ((UI_WIDTH >= 40)) || UI_WIDTH=40

  if $UI_TTY && [[ -z "${NO_COLOR:-}" ]]; then
    C_RESET=$'\033[0m' C_BOLD=$'\033[1m' C_DIM=$'\033[2m'
    C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_CYAN=$'\033[36m'
  else
    C_RESET="" C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_YELLOW="" C_CYAN=""
  fi
  # Box and spinner glyphs need UTF-8: ASCII otherwise, so that nothing comes out garbled.
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*)
      UI_FRAMES=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
      G_OK="✓" G_WARN="!" G_FAIL="✗" G_SKIP="–" G_ASK="?" G_DOT="·" G_ELLIPSIS="…"
      B_TL="╭" B_TR="╮" B_BL="╰" B_BR="╯" B_H="─" B_V="│"
      ;;
    *)
      UI_FRAMES=('|' '/' '-' '\')
      G_OK="+" G_WARN="!" G_FAIL="x" G_SKIP="-" G_ASK="?" G_DOT="." G_ELLIPSIS="..."
      B_TL="+" B_TR="+" B_BL="+" B_BR="+" B_H="-" B_V="|"
      ;;
  esac

  mkdir -p "$(dirname "$UI_LOG")"
  # Readable by its owner only: some commands print more than they should.
  (umask 077 && : >"$UI_LOG")
  printf '=== %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${*:3}" >>"$UI_LOG"
  trap _ui_exit EXIT
  trap _ui_interrupt INT TERM
}

ui_banner() {
  local title=$1 subtitle=$2
  printf '\n  %s%s━━ %s ━━%s\n' "$C_BOLD" "$C_CYAN" "$title" "$C_RESET"
  printf '  %s%s%s\n\n' "$C_DIM" "$subtitle" "$C_RESET"
}

# A line before the steps: what the script found or asked.
ui_say() { printf ' %s%s%s %s\n' "$2" "$1" "$C_RESET" "$3"; }
ui_ok() { ui_say "$G_OK" "$C_GREEN" "$1"; }
ui_warn() { ui_say "$G_WARN" "$C_YELLOW" "$1"; }

# Asks without echoing; the answer in the variable named first.
ui_ask_secret() {
  local __name=$1 __prompt=$2 __value=""
  printf ' %s%s%s %s ' "$C_CYAN" "$G_ASK" "$C_RESET" "$__prompt" >/dev/tty
  IFS= read -rs __value </dev/tty || true
  printf '\n' >/dev/tty
  printf -v "$__name" '%s' "$__value"
}

# Asks for sudo's password now, then keeps it fresh in the background: no prompt in the middle of a
# step, whose output goes to the log.
ui_sudo() {
  sudo -v -p " $C_CYAN$G_ASK$C_RESET Mot de passe sudo de %u : " || ui_fail "sudo a refusé : le script en a besoin pour installer et configurer le Pi."
  (while kill -0 "$$" 2>/dev/null; do sudo -n true 2>/dev/null; sleep 30; done) &
  UI_KEEPALIVE=$!
}

ui_step() {
  UI_INDEX=$((UI_INDEX + 1))
  UI_TITLE=$1 UI_STATUS=ok UI_DETAIL="" UI_NOTES=() UI_STEP_START=$SECONDS UI_ACTIVE=true UI_RC=0
  printf '\n=== %d/%d %s\n' "$UI_INDEX" "$UI_TOTAL" "$UI_TITLE" >>"$UI_LOG"
  $UI_TTY || printf ' %s %d/%d %s\n' "$G_DOT" "$UI_INDEX" "$UI_TOTAL" "$UI_TITLE"
}

ui_task() {
  local label=$1 frame=0 tick=0 detail="" percent=""
  shift
  printf -- '--- %s\n' "$label" >>"$UI_LOG"
  $UI_TTY || printf '     %s\n' "$label"
  # In the background in both cases: a failure is read from `wait`, it never trips `set -e` here, and
  # the command keeps `set -e` for itself.
  "$@" >>"$UI_LOG" 2>&1 &
  UI_PID=$!
  if $UI_TTY; then
    printf '\033[?25l'
    while kill -0 "$UI_PID" 2>/dev/null; do
      # The log is read every 4 frames: a build writes a lot, the Pi has better to do.
      if ((tick % 4 == 0)); then
        detail=$(_ui_last_line)
        percent=$(_ui_percent "$detail")
      fi
      _ui_draw_running "${UI_FRAMES[frame++ % ${#UI_FRAMES[@]}]}" "$label" "$detail" "$percent" "$tick"
      tick=$((tick + 1))
      sleep 0.12
    done
  fi
  UI_RC=0
  wait "$UI_PID" || UI_RC=$?
  UI_PID=""
  $UI_TTY && printf '\r\033[K\n\033[K\033[1A\r'
  return 0
}

ui_run() {
  ui_task "$@"
  ((UI_RC == 0)) || ui_fail "« $1 » a échoué (code $UI_RC) : la fin du journal ci-dessous dit pourquoi."
}

ui_detail() { UI_DETAIL=$1; }

ui_note() {
  UI_STATUS=warn
  UI_NOTES+=("$1")
  UI_ALL_NOTES+=("$UI_INDEX/$UI_TOTAL $UI_TITLE : $1")
  printf '! %s\n' "$1" >>"$UI_LOG"
}

ui_skip() { UI_STATUS=skip UI_DETAIL=$1; }

ui_done() {
  local glyph colour note line
  case $UI_STATUS in
    ok) glyph=$G_OK colour=$C_GREEN ;;
    warn) glyph=$G_WARN colour=$C_YELLOW ;;
    skip) glyph=$G_SKIP colour=$C_DIM ;;
  esac
  _ui_step_line "$glyph" "$colour" "$(_ui_duration $((SECONDS - UI_STEP_START)))"
  [[ -n $UI_DETAIL ]] && _ui_indented "$C_DIM" "$UI_DETAIL"
  for note in "${UI_NOTES[@]+"${UI_NOTES[@]}"}"; do
    _ui_wrap $((UI_WIDTH - 7)) "$note"
    printf '     %s%s%s %s\n' "$C_YELLOW" "$G_WARN" "$C_RESET" "${UI_WRAPPED[0]}"
    for line in "${UI_WRAPPED[@]:1}"; do printf '       %s\n' "$line"; done
  done
  UI_ACTIVE=false
}

ui_fail() {
  local reason=$1 line
  if $UI_ACTIVE; then
    _ui_step_line "$G_FAIL" "$C_RED" "$(_ui_duration $((SECONDS - UI_STEP_START)))"
    UI_ACTIVE=false
  fi
  printf '\n'
  _ui_wrap $((UI_WIDTH - 4)) "$reason"
  ui_box "$C_RED" "Arrêt" "${UI_WRAPPED[@]}"
  # What the command that failed printed last, when one did: the other steps' lines would only blur it.
  if ((UI_RC != 0)); then
    printf '\n   %sCe que la commande a dit en dernier :%s\n' "$C_BOLD" "$C_RESET"
    while IFS= read -r line; do
      line=$(_ui_clean "$line")
      ((${#line} > UI_COLS - 4)) && line="${line:0:UI_COLS-5}$G_ELLIPSIS"
      printf '   %s%s%s\n' "$C_DIM" "$line" "$C_RESET"
    done < <(awk '/^--- /{n = 0; next} {line[n++] = $0} END {for (i = (n > 15 ? n - 15 : 0); i < n; i++) print line[i]}' "$UI_LOG")
  fi
  printf '\n   Journal complet : %s\n\n' "$(_ui_home "$UI_LOG")"
  printf '\n! ARRÊT : %s\n' "$reason" >>"$UI_LOG"
  exit 1
}

ui_box() {
  local colour=$1 title=$2 line width=0 rule max lines=()
  shift 2
  # Within the terminal: a longer line goes on as many lines as it takes.
  max=$((UI_COLS - 5))
  for line in "$@"; do
    while ((${#line} > max)); do
      lines+=("${line:0:max}")
      line="  ${line:max}"
    done
    lines+=("$line")
  done
  set -- "${lines[@]}"
  for line in "$@"; do ((${#line} > width)) && width=${#line}; done
  ((${#title} + 4 > width)) && width=$((${#title} + 4))
  rule=$(_ui_repeat "$B_H" $((width - ${#title} - 1)))
  printf ' %s%s%s %s%s%s %s%s%s\n' "$colour" "$B_TL$B_H" "$C_RESET" "$C_BOLD" "$title" "$C_RESET" "$colour" "$rule$B_TR" "$C_RESET"
  for line in "$@"; do
    printf ' %s%s%s %s%*s %s%s%s\n' "$colour" "$B_V" "$C_RESET" "$line" $((width - ${#line})) "" "$colour" "$B_V" "$C_RESET"
  done
  printf ' %s%s%s\n' "$colour" "$B_BL$(_ui_repeat "$B_H" $((width + 2)))$B_BR" "$C_RESET"
}

# --- inside ----------------------------------------------------------------------------------------

_ui_step_line() {
  local glyph=$1 colour=$2 time=$3 head fill
  head="$glyph $UI_INDEX/$UI_TOTAL $UI_TITLE"
  fill=$((UI_WIDTH - ${#head} - ${#time} - 3))
  ((fill >= 1)) || fill=1
  printf ' %s%s%s %s%d/%d%s %s %s%s%s %s\n' "$colour" "$glyph" "$C_RESET" "$C_BOLD" "$UI_INDEX" "$UI_TOTAL" "$C_RESET" \
    "$UI_TITLE" "$C_DIM" "$(_ui_repeat "$G_DOT" "$fill")" "$C_RESET" "$time"
}

# How wide the bar under a running step is, and the block that goes back and forth in it.
UI_BAR=24
UI_BLOCK=5

_ui_draw_running() {
  local frame=$1 label=$2 detail=$3 percent=$4 tick=$5 time head fill steps bar share below room
  time=$(_ui_duration $((SECONDS - UI_STEP_START)))
  head="$frame $UI_INDEX/$UI_TOTAL $UI_TITLE"
  fill=$((UI_WIDTH - ${#head} - ${#time} - 3))
  ((fill >= 1)) || fill=1
  # The steps done, out of all of them, on what leads to the time.
  steps=$((fill * (UI_INDEX - 1) / UI_TOTAL))
  if [[ -n $percent ]]; then
    bar=$(_ui_bar "$percent")
    share="$(printf '%3d' "$percent") %"
  else
    bar=$(_ui_bounce "$tick")
    share=""
  fi
  below="$label${detail:+ $G_DOT $detail}"
  room=$((UI_COLS - 6 - UI_BAR - 3 - ${#share} - (${#share} > 0)))
  ((room >= 8)) || room=8
  ((${#below} > room)) && below="${below:0:room-1}$G_ELLIPSIS"
  printf '\r\033[K %s%s%s %s%d/%d%s %s %s%s%s%s%s%s %s\n\033[K     %s[%s]%s%s %s%s%s\033[1A\r' \
    "$C_CYAN" "$frame" "$C_RESET" "$C_BOLD" "$UI_INDEX" "$UI_TOTAL" "$C_RESET" "$UI_TITLE" \
    "$C_CYAN" "$(_ui_repeat "#" "$steps")" "$C_RESET" "$C_DIM" "$(_ui_repeat "$G_DOT" $((fill - steps)))" "$C_RESET" "$time" \
    "$C_CYAN" "$bar" "$C_RESET" "${share:+ $share}" "$C_DIM" "$below" "$C_RESET"
}

# How far a command says it is, 0 to 100, from the line it printed last: a percentage (« 45 % », as
# esptool and pip do), or a count out of a total (« [3/12] », as a docker build does). Nothing when
# the line says neither: most commands do not.
_ui_percent() {
  local line=$1 percent=""
  if [[ $line =~ ([0-9]{1,3})(\.[0-9]+)?[[:space:]]?% ]]; then
    percent=$((10#${BASH_REMATCH[1]}))
  elif [[ $line =~ \[[[:space:]]*([0-9]{1,4})/([0-9]{1,4})\] ]] && ((10#${BASH_REMATCH[2]} > 0)); then
    percent=$((10#${BASH_REMATCH[1]} * 100 / 10#${BASH_REMATCH[2]}))
  fi
  [[ -n $percent ]] && ((percent <= 100)) && printf '%d' "$percent"
  return 0
}

# The bar filled to a percentage.
_ui_bar() {
  local filled=$((UI_BAR * $1 / 100))
  printf '%s%s' "$(_ui_repeat "#" "$filled")" "$(_ui_repeat "$G_DOT" $((UI_BAR - filled)))"
}

# The bar of a command that does not say how far it is: a block of # that goes from one end to the
# other and back, a place a frame.
_ui_bounce() {
  local span=$((UI_BAR - UI_BLOCK)) at
  at=$(($1 % (2 * span)))
  ((at > span)) && at=$((2 * span - at))
  printf '%s%s%s' "$(_ui_repeat "$G_DOT" "$at")" "$(_ui_repeat "#" "$UI_BLOCK")" "$(_ui_repeat "$G_DOT" $((span - at)))"
}

_ui_indented() {
  local colour=$1 line
  _ui_wrap $((UI_WIDTH - 5)) "$2"
  for line in "${UI_WRAPPED[@]}"; do printf '     %s%s%s\n' "$colour" "$line" "$C_RESET"; done
}

# The log's last line as a terminal shows it: what follows the last carriage return, without colours
# nor control characters.
_ui_last_line() {
  local line
  line=$(tail -n 1 "$UI_LOG" 2>/dev/null) || return 0
  # The log's own markers say nothing the step's line does not.
  [[ $line == "--- "* || $line == "=== "* ]] && return 0
  _ui_clean "$line"
}

_ui_clean() {
  local line=${1##*$'\r'}
  line=${line//$'\033'\[*([0-9;?])[A-Za-z]/}
  line=${line//[[:cntrl:]]/}
  printf '%s' "${line##+([[:space:]])}"
}

# Words to lines of at most `width` characters, in UI_WRAPPED.
_ui_wrap() {
  local width=$1 line="" word words
  read -ra words <<<"$2"
  UI_WRAPPED=()
  for word in "${words[@]+"${words[@]}"}"; do
    if [[ -z $line ]]; then
      line=$word
    elif ((${#line} + 1 + ${#word} <= width)); then
      line="$line $word"
    else
      UI_WRAPPED+=("$line")
      line=$word
    fi
  done
  UI_WRAPPED+=("$line")
}

_ui_repeat() {
  local out="" i
  for ((i = 0; i < $2; i++)); do out+=$1; done
  printf '%s' "$out"
}

_ui_duration() {
  local s=$1
  if ((s < 60)); then
    printf '%ds' "$s"
  elif ((s < 3600)); then
    printf '%dm%02ds' $((s / 60)) $((s % 60))
  else
    printf '%dh%02dm' $((s / 3600)) $((s % 3600 / 60))
  fi
}

# The path with ~ for the home directory: shorter to read, the same to type.
# Through a variable: a literal ~ there is expanded by some versions of bash, quoted by others.
_ui_home() {
  local tilde="~"
  printf '%s' "${1/#"$HOME"/$tilde}"
}

_ui_exit() {
  [[ -n ${UI_KEEPALIVE:-} ]] && kill "$UI_KEEPALIVE" 2>/dev/null
  $UI_TTY && printf '\033[?25h'
  return 0
}

_ui_interrupt() {
  trap - INT TERM
  # Ctrl-C reaches the command of the step as well: it stops with the script.
  [[ -n ${UI_PID:-} ]] && kill "$UI_PID" 2>/dev/null
  $UI_TTY && printf '\r\033[K\n\033[K\033[1A\r'
  if $UI_ACTIVE; then _ui_step_line "$G_FAIL" "$C_RED" "$(_ui_duration $((SECONDS - UI_STEP_START)))"; fi
  printf '\n %s%s%s Interrompu. Relance le script quand tu veux : il reprend sans rien casser.\n\n' "$C_RED" "$G_FAIL" "$C_RESET"
  exit 130
}
