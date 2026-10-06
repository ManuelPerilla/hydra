# Build on each target architecture; Buildx uses native runners or QEMU for ARM.
FROM rust:1.99.0-slim-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/hydra-chaos-agent /usr/local/bin/hydra-chaos-agent
USER 10001:10001
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/hydra-chaos-agent"]
