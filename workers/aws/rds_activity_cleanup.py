"""Cloud-side watchdog, scoped only to the disposable credit-activity database."""
import datetime
import os

import boto3

DB = "riceguard-credit-activity-20260928"
RULE = "riceguard-credit-rds-cleanup"


def handler(event, context):
    rds = boto3.client("rds")
    deadline = datetime.datetime.fromisoformat(os.environ["CLEANUP_AFTER"])
    try:
        db = rds.describe_db_instances(DBInstanceIdentifier=DB)["DBInstances"][0]
    except rds.exceptions.DBInstanceNotFoundFault:
        done = datetime.datetime.now(datetime.timezone.utc) >= deadline or event.get("cleanup_now")
        if done:
            boto3.client("events").disable_rule(Name=RULE)
        return {"status": "absent", "schedule_disabled": bool(done)}
    tags = {t["Key"]: t["Value"] for t in rds.list_tags_for_resource(ResourceName=db["DBInstanceArn"])["TagList"]}
    if tags.get("Purpose") != "disposable-credit-activity":
        raise RuntimeError("Refusing cleanup of an unrecognized database")
    if datetime.datetime.now(datetime.timezone.utc) < deadline and not event.get("cleanup_now"):
        return {"status": db["DBInstanceStatus"], "deadline": deadline.isoformat()}
    if db["DBInstanceStatus"] == "deleting":
        return {"status": "deleting"}
    try:
        rds.delete_db_instance(DBInstanceIdentifier=DB, SkipFinalSnapshot=True, DeleteAutomatedBackups=True)
        return {"status": "delete_requested", "only_disposable_empty_database": True}
    except rds.exceptions.InvalidDBInstanceStateFault:
        return {"status": "retry_next_tick", "database_state": db["DBInstanceStatus"]}
