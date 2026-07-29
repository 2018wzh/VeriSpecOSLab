FROM minio/mc:RELEASE.2025-04-16T18-13-26Z AS minio-client

FROM postgres:16-alpine
RUN apk add --no-cache coreutils
COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc
COPY apps/vos-portal/ops /opt/vos-portal/ops
RUN chmod 0555 /opt/vos-portal/ops/*.sh
ENTRYPOINT ["/opt/vos-portal/ops/entrypoint.sh"]
