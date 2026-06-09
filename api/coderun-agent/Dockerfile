# Start from the official Red Hat UBI 9 Python 3.12 image
FROM registry.access.redhat.com/ubi9/python-312

# Switch to the root user for system-level installs
USER 0

# Install build dependencies required for some Python packages.
RUN dnf install -y openssl-devel rustc cargo openblas-devel pkgconf && \
    dnf clean all

# Set the working directory and make it writable by the non-root user. Building
# the local package (`uv pip install .`) writes a *.egg-info dir into /app, so it
# must be owned by USER 1001 or the build fails with "Permission denied".
WORKDIR /app
RUN chown -R 1001:1001 /app

# Switch back to the default non-root user (best practice)
USER 1001

# Need to use correct pythong version
ENV PATH="/opt-app-root/bin:${PATH}"

# Install UV
RUN /opt/app-root/bin/python3 -m pip install uv

# Dependencies. README.md is included because pyproject.toml declares it as the
# project readme; the build backend errors if it is missing.
COPY --chown=1001:1001 pyproject.toml uv.lock README.md ./
RUN uv pip install --system --python /opt/app-root/bin/python3 .

# Copy app
COPY --chown=1001:1001 agent.py log_conf.yml ./

# server port.
EXPOSE 8000

# Launch server
CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8000", "--log-config", "log_conf.yml"]
