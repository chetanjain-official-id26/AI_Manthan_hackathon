# syntax=docker/dockerfile:1
# Build stage: Maven wrapper on JDK 21
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -q -B dependency:go-offline
COPY src src
RUN ./mvnw -q -B -DskipTests package

# Runtime stage: JRE only, non-root user
FROM eclipse-temurin:21-jre
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app && useradd --system --gid app --home /app app \
    && mkdir -p /data/receipts && chown -R app:app /data
WORKDIR /app
COPY --from=build /src/target/expenseflow-backend.jar app.jar
USER app
ENV TZ=Asia/Kolkata \
    RECEIPTS_DIR=/data/receipts \
    JAVA_OPTS="-Xms256m -Xmx768m"
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fsS http://localhost:8080/actuator/health/readiness >/dev/null || exit 1
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -Duser.timezone=Asia/Kolkata -jar /app/app.jar"]
