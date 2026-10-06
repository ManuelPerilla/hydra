# syntax=docker/dockerfile:1.7
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0@sha256:e70cdb7f80b0348f5cb85f19a8f670fca061f033d57eed12fa003d58b0e06317 AS build
ARG TARGETARCH
WORKDIR /source
COPY global.json Directory.Build.props ./
COPY src/Hydra.Api/Hydra.Api.csproj src/Hydra.Api/
RUN dotnet restore src/Hydra.Api/Hydra.Api.csproj -a $TARGETARCH
COPY src/ src/
RUN dotnet publish src/Hydra.Api/Hydra.Api.csproj -c Release -a $TARGETARCH --no-restore -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:222759b391a1aaf241166672c8f99b2d4ada452e7b5319f3c6e8f265a37b5ad4 AS runtime
WORKDIR /app
COPY --from=build /app ./
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080 DOTNET_EnableDiagnostics=0
EXPOSE 8080
ENTRYPOINT ["dotnet", "Hydra.Api.dll"]
