-- SPDX-License-Identifier: Apache-2.0
-- Run on a disposable database only; the test transaction always rolls back.
BEGIN;
INSERT INTO aphrody_product.scopes(profile) VALUES ('aphrody'), ('ie');
INSERT INTO aphrody_product.catalog(profile, entity_id, kind, owner, label, source_ref, content_sha256)
VALUES ('aphrody', 'repo', 'repository', 'workspace', 'Aphrody', 'git:aphrody', repeat('a', 64)),
       ('ie', 'repo', 'repository', 'workspace', 'IE', 'git:ie', repeat('b', 64));
INSERT INTO aphrody_product.graph_nodes(profile, repository_id, node_id, symbol, relative_path, kind)
VALUES ('aphrody', 'repo', 'node1', 'main', 'src/main.rs', 'function');
INSERT INTO aphrody_product.outbox(profile, entity_id, entity_version, topic)
VALUES ('aphrody', 'repo', 1, 'catalog.changed');
DO $$
DECLARE
    unsafe_path TEXT;
BEGIN
    BEGIN
        INSERT INTO aphrody_product.graph_edges(profile, repository_id, src, dst, relation, confidence)
        VALUES ('ie', 'repo', 'node1', 'node1', 'calls', 'EXTRACTED');
        RAISE EXCEPTION 'cross-profile graph reference unexpectedly accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO aphrody_product.outbox(profile, entity_id, entity_version, topic)
        VALUES ('aphrody', 'repo', 1, 'catalog.changed');
        RAISE EXCEPTION 'duplicate event unexpectedly accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO aphrody_product.scopes(profile) VALUES ('unknown');
        RAISE EXCEPTION 'unknown profile unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    FOREACH unsafe_path IN ARRAY ARRAY['../protected', '/etc/passwd', E'\\\\server\\share', E'C:\\Windows', 'C:/Windows', 'https://example.com/source', 'file:///protected', 'src/../protected', E'src\\..\\protected'] LOOP
        BEGIN
            INSERT INTO aphrody_product.graph_nodes(profile, repository_id, node_id, symbol, relative_path, kind)
            VALUES ('aphrody', 'repo', 'unsafe', 'private', unsafe_path, 'function');
            RAISE EXCEPTION 'unsafe source path unexpectedly accepted: %', unsafe_path;
        EXCEPTION WHEN check_violation THEN NULL;
        END;
    END LOOP;
    IF has_schema_privilege('public', 'aphrody_product', 'USAGE') THEN
        RAISE EXCEPTION 'PUBLIC unexpectedly has schema access';
    END IF;
END $$;
ROLLBACK;
