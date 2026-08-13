FROM python:3.12-slim@sha256:d657ab0ade19f404a6ccc883ab399540de667aff751748ce23c07330c5a89e64

ENV HOME=/var/lib/tokenpak \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TOKENPAK_HOME=/var/lib/tokenpak

WORKDIR /srv/tokenpak

COPY requirements.lock ./requirements.lock
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.lock

COPY config.yaml /etc/tokenpak/config.yaml
COPY entrypoint.sh /usr/local/bin/starguidance-tokenpak
COPY runtime-chain-request.py /srv/tokenpak/runtime-chain-request.py
COPY runtime-policy-smoke.py /srv/tokenpak/runtime-policy-smoke.py
COPY runtime-http-smoke.py /srv/tokenpak/runtime-http-smoke.py
RUN chmod 0555 /usr/local/bin/starguidance-tokenpak \
    && chmod 0444 /etc/tokenpak/config.yaml /srv/tokenpak/runtime-chain-request.py /srv/tokenpak/runtime-policy-smoke.py /srv/tokenpak/runtime-http-smoke.py \
    && python -c "from importlib.metadata import version; assert version('tokenpak') == '1.18.5'"

USER 65532:65532

ENTRYPOINT ["/usr/local/bin/starguidance-tokenpak"]
