-- ExpenseFlow schema (LLD §4). Money is NUMERIC(14,2); times are timestamptz.

CREATE TABLE department (
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(20)  NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL
);

CREATE TABLE employee (
    id                  BIGSERIAL PRIMARY KEY,
    emp_code            VARCHAR(20)  NOT NULL UNIQUE,
    name                VARCHAR(120) NOT NULL,
    email               VARCHAR(160) NOT NULL UNIQUE,
    department_id       BIGINT REFERENCES department (id),
    manager_id          BIGINT REFERENCES employee (id),
    roles               VARCHAR(100) NOT NULL DEFAULT 'EMPLOYEE',
    bank_account_masked VARCHAR(30),
    ifsc                VARCHAR(15),
    active              BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT employee_not_own_manager CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE INDEX idx_employee_manager ON employee (manager_id);
CREATE INDEX idx_employee_department ON employee (department_id);

CREATE TABLE delegation (
    id           BIGSERIAL PRIMARY KEY,
    delegator_id BIGINT      NOT NULL REFERENCES employee (id),
    delegate_id  BIGINT      NOT NULL REFERENCES employee (id),
    from_date    DATE        NOT NULL,
    to_date      DATE        NOT NULL,
    reason       VARCHAR(300),
    revoked      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_by   BIGINT REFERENCES employee (id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT delegation_not_self CHECK (delegator_id <> delegate_id),
    CONSTRAINT delegation_dates CHECK (to_date >= from_date)
);
CREATE INDEX idx_delegation_delegate ON delegation (delegate_id, from_date, to_date) WHERE NOT revoked;
CREATE INDEX idx_delegation_delegator ON delegation (delegator_id) WHERE NOT revoked;

-- ---------------------------------------------------------------- config
CREATE TABLE app_config (
    id           BIGSERIAL PRIMARY KEY,
    config_key   VARCHAR(60)  NOT NULL,
    config_value VARCHAR(200) NOT NULL,
    version      INT          NOT NULL,
    active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by   BIGINT REFERENCES employee (id),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (config_key, version)
);

CREATE TABLE policy_rule (
    id             BIGSERIAL PRIMARY KEY,
    rule_code      VARCHAR(50)  NOT NULL,
    category       VARCHAR(20),
    city_tier      VARCHAR(10),
    limit_amount   NUMERIC(14, 2),
    unit           VARCHAR(10)  NOT NULL,
    action         VARCHAR(15)  NOT NULL CHECK (action IN ('AUTO_APPROVE', 'ROUTE', 'AUTO_REJECT')),
    flag           VARCHAR(20),
    params         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
    active         BOOLEAN      NOT NULL DEFAULT TRUE, -- true only on the latest version of a key
    version        INT          NOT NULL,
    effective_from TIMESTAMPTZ  NOT NULL,
    reason         VARCHAR(300),
    created_by     BIGINT REFERENCES employee (id),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT policy_rule_key UNIQUE NULLS NOT DISTINCT (rule_code, category, city_tier, version)
);

CREATE TABLE approval_threshold (
    id                  BIGSERIAL PRIMARY KEY,
    level               VARCHAR(20)    NOT NULL CHECK (level IN ('MANAGER', 'AUDITOR', 'FINANCE_HEAD')),
    seq                 INT            NOT NULL,
    min_total_exclusive NUMERIC(14, 2) NOT NULL,
    role                VARCHAR(20)    NOT NULL,
    version             INT            NOT NULL,
    active              BOOLEAN        NOT NULL DEFAULT TRUE,
    reason              VARCHAR(300),
    created_by          BIGINT REFERENCES employee (id),
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
    UNIQUE (level, version)
);

-- ---------------------------------------------------------------- claims
CREATE SEQUENCE claim_no_seq START 1;

CREATE TABLE claim (
    id             BIGSERIAL PRIMARY KEY,
    claim_no       VARCHAR(30)    NOT NULL UNIQUE,
    employee_id    BIGINT         NOT NULL REFERENCES employee (id),
    title          VARCHAR(200)   NOT NULL,
    status         VARCHAR(30)    NOT NULL,
    total_amount   NUMERIC(14, 2) NOT NULL DEFAULT 0,
    sample_audit   BOOLEAN        NOT NULL DEFAULT FALSE,
    split_suspect  BOOLEAN        NOT NULL DEFAULT FALSE,
    policy_outcome VARCHAR(15),
    cycle_no       INT            NOT NULL DEFAULT 0,
    submitted_at   TIMESTAMPTZ,
    approved_at    TIMESTAMPTZ,
    paid_at        TIMESTAMPTZ,
    version        INT            NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ    NOT NULL,
    updated_at     TIMESTAMPTZ    NOT NULL,
    CONSTRAINT claim_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'POLICY_REJECTED', 'PENDING_MANAGER',
        'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD', 'SENT_BACK', 'APPROVED', 'IN_PAYOUT', 'PAID', 'REJECTED')),
    CONSTRAINT claim_total_non_negative CHECK (total_amount >= 0)
);
CREATE INDEX idx_claim_employee ON claim (employee_id);
CREATE INDEX idx_claim_status_submitted ON claim (status, submitted_at);

CREATE TABLE claim_line (
    id           BIGSERIAL PRIMARY KEY,
    claim_id     BIGINT         NOT NULL REFERENCES claim (id),
    category     VARCHAR(20)    NOT NULL CHECK (category IN ('MEAL', 'HOTEL', 'CAB', 'OTHER')),
    amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    expense_date DATE           NOT NULL,
    vendor       VARCHAR(160)   NOT NULL,
    vendor_norm  VARCHAR(160)   NOT NULL,
    city         VARCHAR(80),
    city_tier    VARCHAR(10)    NOT NULL CHECK (city_tier IN ('TIER_1', 'OTHER')),
    nights       INT,
    description  VARCHAR(500),
    line_outcome VARCHAR(15),
    created_at   TIMESTAMPTZ    NOT NULL,
    CONSTRAINT claim_line_hotel_nights CHECK (category <> 'HOTEL' OR nights >= 1)
);
CREATE INDEX idx_claim_line_claim ON claim_line (claim_id);
CREATE INDEX idx_claim_line_dup ON claim_line (vendor_norm, amount, expense_date);
CREATE INDEX idx_claim_line_date_cat ON claim_line (expense_date, category);

CREATE TABLE receipt (
    id            BIGSERIAL PRIMARY KEY,
    claim_line_id BIGINT       NOT NULL UNIQUE REFERENCES claim_line (id) ON DELETE CASCADE,
    storage_key   VARCHAR(64)  NOT NULL,
    original_name VARCHAR(120) NOT NULL,
    content_type  VARCHAR(40)  NOT NULL,
    size_bytes    BIGINT       NOT NULL,
    sha256        CHAR(64)     NOT NULL,
    uploaded_by   BIGINT REFERENCES employee (id),
    uploaded_at   TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_receipt_sha256 ON receipt (sha256); -- not unique: duplicates are stored so they can be flagged

CREATE TABLE policy_result (
    id              BIGSERIAL PRIMARY KEY,
    claim_line_id   BIGINT      NOT NULL REFERENCES claim_line (id) ON DELETE CASCADE,
    rule_id         BIGINT      NOT NULL REFERENCES policy_rule (id),
    rule_code       VARCHAR(50) NOT NULL,
    rule_version    INT         NOT NULL,
    outcome         VARCHAR(15) NOT NULL,
    flag            VARCHAR(20),
    reason          VARCHAR(300),
    related_line_id BIGINT,
    evaluation_no   INT         NOT NULL,
    evaluated_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_policy_result_line ON policy_result (claim_line_id, evaluation_no);
CREATE INDEX idx_policy_result_rule ON policy_result (rule_code);

-- ---------------------------------------------------------------- approvals
CREATE TABLE approval_step (
    id            BIGSERIAL PRIMARY KEY,
    claim_id      BIGINT      NOT NULL REFERENCES claim (id),
    seq           INT         NOT NULL,
    level         VARCHAR(20) NOT NULL,
    assignee_id   BIGINT REFERENCES employee (id),
    assignee_role VARCHAR(20) NOT NULL,
    status        VARCHAR(15) NOT NULL CHECK (status IN ('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'SENT_BACK', 'CANCELLED')),
    threshold_id  BIGINT REFERENCES approval_threshold (id),
    acted_by      BIGINT REFERENCES employee (id),
    on_behalf_of  BIGINT REFERENCES employee (id),
    activated_at  TIMESTAMPTZ,
    acted_at      TIMESTAMPTZ,
    note          VARCHAR(1000),
    cycle_no      INT         NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_step_assignee_status ON approval_step (assignee_id, status);
CREATE INDEX idx_step_status_activated ON approval_step (status, activated_at);
CREATE INDEX idx_step_claim ON approval_step (claim_id, cycle_no, seq);

CREATE TABLE claim_comment (
    id         BIGSERIAL PRIMARY KEY,
    claim_id   BIGINT        NOT NULL REFERENCES claim (id),
    author_id  BIGINT        NOT NULL REFERENCES employee (id),
    body       VARCHAR(2000) NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL
);
CREATE INDEX idx_comment_claim ON claim_comment (claim_id);

-- ---------------------------------------------------------------- payouts
CREATE TABLE payout_batch (
    id           BIGSERIAL PRIMARY KEY,
    batch_no     VARCHAR(20)    NOT NULL UNIQUE,
    status       VARCHAR(15)    NOT NULL CHECK (status IN ('CREATED', 'EXPORTED', 'PAID', 'VOIDED')),
    claim_count  INT            NOT NULL,
    total_amount NUMERIC(14, 2) NOT NULL,
    file_name    VARCHAR(60),
    file_sha256  CHAR(64),
    void_reason  VARCHAR(300),
    created_by   BIGINT         NOT NULL REFERENCES employee (id),
    created_at   TIMESTAMPTZ    NOT NULL,
    exported_at  TIMESTAMPTZ,
    paid_at      TIMESTAMPTZ,
    voided_at    TIMESTAMPTZ,
    version      INT            NOT NULL DEFAULT 0
);

CREATE TABLE payout_item (
    id          BIGSERIAL PRIMARY KEY,
    batch_id    BIGINT         NOT NULL REFERENCES payout_batch (id),
    claim_id    BIGINT         NOT NULL REFERENCES claim (id),
    employee_id BIGINT         NOT NULL REFERENCES employee (id),
    amount      NUMERIC(14, 2) NOT NULL,
    active      BOOLEAN        NOT NULL DEFAULT TRUE -- false once the batch is voided
);
-- R14: a claim can sit in only one active (non-voided) batch
CREATE UNIQUE INDEX ux_payout_item_active_claim ON payout_item (claim_id) WHERE active;
CREATE INDEX idx_payout_item_batch ON payout_item (batch_id);

-- ---------------------------------------------------------------- audit
CREATE TABLE audit_event (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     VARCHAR(30) NOT NULL,
    entity_id       BIGINT,
    claim_id        BIGINT,
    action          VARCHAR(50) NOT NULL,
    actor_id        BIGINT,
    on_behalf_of_id BIGINT,
    before          JSONB,
    after           JSONB,
    ip              VARCHAR(64),
    request_id      VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_event (entity_type, entity_id);
CREATE INDEX idx_audit_claim ON audit_event (claim_id, created_at);
CREATE INDEX idx_audit_actor ON audit_event (actor_id, created_at);
CREATE INDEX idx_audit_action ON audit_event (action, created_at);

-- BR-24 / R15: audit_event is append-only
CREATE FUNCTION audit_event_no_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_event is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_mutation
    BEFORE UPDATE OR DELETE ON audit_event
    FOR EACH ROW EXECUTE FUNCTION audit_event_no_mutation();

CREATE TRIGGER audit_event_no_truncate
    BEFORE TRUNCATE ON audit_event
    FOR EACH STATEMENT EXECUTE FUNCTION audit_event_no_mutation();

-- R4: line business fields are frozen unless the claim is DRAFT or SENT_BACK
CREATE FUNCTION claim_line_guard() RETURNS trigger AS $$
DECLARE
    st VARCHAR(30);
BEGIN
    SELECT status INTO st FROM claim WHERE id = COALESCE(NEW.claim_id, OLD.claim_id);
    IF st IN ('DRAFT', 'SENT_BACK') THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.amount = OLD.amount AND NEW.category = OLD.category
       AND NEW.expense_date = OLD.expense_date AND NEW.vendor = OLD.vendor
       AND NEW.city_tier = OLD.city_tier AND NEW.nights IS NOT DISTINCT FROM OLD.nights
       AND NEW.claim_id = OLD.claim_id THEN
        RETURN NEW; -- only system fields (line_outcome) changed
    END IF;
    RAISE EXCEPTION 'claim_line is locked: claim status is %', st;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claim_line_guard
    BEFORE INSERT OR UPDATE OR DELETE ON claim_line
    FOR EACH ROW EXECUTE FUNCTION claim_line_guard();
