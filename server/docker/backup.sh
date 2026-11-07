#!/bin/sh
# Sauvegarde de la base du boîtier école (service « backup » de docker-compose.box.yml).
#   backup.sh loop   boucle : une sauvegarde par jour, dès BACKUP_HOUR (2 h) passée, ou au démarrage
#                    s'il n'y en a encore aucune ; un boîtier éteint la nuit est sauvegardé à l'allumage.
#   backup.sh now    une sauvegarde tout de suite.
# Format pg_dump « custom » (compressé, restauration sélective possible), vérifié par pg_restore -l,
# écrit sous un nom provisoire puis renommé : une coupure de courant ne laisse pas de demi-fichier.
# Les BACKUP_KEEP (14) plus récentes sont gardées. Connexion : PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
set -eu
DIR=${BACKUP_DIR:-/backups}
KEEP=${BACKUP_KEEP:-14}
HOUR=${BACKUP_HOUR:-2}
umask 022

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

backup() {
  stamp=$(date +%Y%m%d-%H%M)
  final="$DIR/jollof-$stamp.dump"
  tmp="$DIR/.jollof-$stamp.dump.part"
  if pg_dump -Fc -Z 6 -f "$tmp" && pg_restore -l "$tmp" >/dev/null; then
    mv "$tmp" "$final"
    log "sauvegarde : $(basename "$final") ($(du -h "$final" | cut -f1))"
    ls -1t "$DIR"/jollof-*.dump | tail -n +$((KEEP + 1)) | while read -r old; do
      rm -f "$old" && log "supprimée (rotation) : $(basename "$old")"
    done
  else
    rm -f "$tmp"
    log "ÉCHEC de la sauvegarde (nouvel essai dans 15 min)" >&2
    return 1
  fi
}

case "${1:-loop}" in
  now) backup ;;
  loop)
    mkdir -p "$DIR"
    log "sauvegardes dans $DIR : une par jour dès ${HOUR} h, ${KEEP} gardées"
    while :; do
      today=$(date +%Y%m%d)
      hour=$(date +%H)
      if ! ls "$DIR"/jollof-*.dump >/dev/null 2>&1; then
        backup || true
      elif [ "${hour#0}" -ge "$HOUR" ] && ! ls "$DIR"/jollof-"$today"-*.dump >/dev/null 2>&1; then
        backup || true
      fi
      sleep 900
    done
    ;;
  *) echo "usage : backup.sh [loop|now]" >&2; exit 2 ;;
esac
