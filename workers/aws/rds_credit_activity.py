"""One empty private RDS instance, bounded by a cloud-side cleanup watchdog.

No application data, public networking, snapshots, paid insights, or monitoring.
Never re-creates the DB on a second invocation. Credits are not assumed earned.
"""
import argparse
import datetime
import io
import json
from pathlib import Path
import secrets
import time
import zipfile

import boto3
from botocore.exceptions import ClientError

REGION = "us-east-1"
DB = "riceguard-credit-activity-20260928"
NAME = "riceguard-credit-rds-cleanup"
ACCOUNT = "342278407276"
session = boto3.Session(region_name=REGION)


def main(action):
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Wrong account")
    rds = session.client("rds")
    lam = session.client("lambda")
    events = session.client("events")
    if action == "cleanup-resources":
        if any(d["DBInstanceIdentifier"] == DB for d in rds.describe_db_instances()["DBInstances"]):
            raise RuntimeError("Database still exists; preserve its cleanup watchdog")
        events.disable_rule(Name=NAME)
        events.remove_targets(Rule=NAME, Ids=["Cleanup"])
        events.delete_rule(Name=NAME)
        lam.delete_function(FunctionName=NAME)
        iam = session.client("iam")
        iam.delete_role_policy(RoleName=NAME, PolicyName="OnlyDisposableDatabaseCleanup")
        iam.delete_role(RoleName=NAME)
        rds.delete_db_subnet_group(DBSubnetGroupName=DB)
        ec2 = session.client("ec2")
        groups = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": [DB]}])["SecurityGroups"]
        for group in groups:
            if {t["Key"]: t["Value"] for t in group.get("Tags", [])}.get("Purpose") != "disposable-credit-activity":
                raise RuntimeError("Refusing deletion of an unrecognized group")
            ec2.delete_security_group(GroupId=group["GroupId"])
        print(json.dumps({"temporary_rds_resources": "removed", "user_data_deleted": False}))
        return
    if action == "status":
        instances = rds.describe_db_instances()["DBInstances"]
        print(json.dumps([{"id": d["DBInstanceIdentifier"], "status": d["DBInstanceStatus"],
                           "public": d["PubliclyAccessible"]} for d in instances if d["DBInstanceIdentifier"] == DB]))
        return
    if action == "cleanup":
        response = lam.invoke(FunctionName=NAME, Payload=b'{"cleanup_now":true}')
        payload = json.loads(response["Payload"].read())
        if response.get("FunctionError"):
            raise RuntimeError(payload)
        print(json.dumps(payload))
        return
    activities = session.client("freetier").list_account_activities()["activities"]
    if any(a["activityId"] == "8205347977b6d2134653bc122ea7d4f3" and a["status"] == "COMPLETED" for a in activities):
        print(json.dumps({"status": "activity_already_completed", "database_created": False}))
        return
    credit = session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"]
    if credit < 20:
        raise RuntimeError("Insufficient credit reserve; no RDS activity started")
    iam = session.client("iam")
    try:
        iam.get_role(RoleName=NAME)
        raise RuntimeError("Activity already provisioned. Use status/cleanup, never duplicate it.")
    except iam.exceptions.NoSuchEntityException:
        pass
    ec2 = session.client("ec2")
    vpc = ec2.describe_vpcs(Filters=[{"Name": "is-default", "Values": ["true"]}])["Vpcs"][0]["VpcId"]
    subnet_ids = [s["SubnetId"] for s in ec2.describe_subnets(Filters=[{"Name": "vpc-id", "Values": [vpc]}])["Subnets"]]
    # Dedicated security group with zero incoming rules. Never exposes Postgres.
    sg = ec2.create_security_group(GroupName=DB, Description="No ingress; empty credit activity DB", VpcId=vpc)["GroupId"]
    ec2.create_tags(Resources=[sg], Tags=[{"Key": "Purpose", "Value": "disposable-credit-activity"}])
    rds.create_db_subnet_group(DBSubnetGroupName=DB, DBSubnetGroupDescription="Temporary activity", SubnetIds=subnet_ids)
    role = iam.create_role(RoleName=NAME, AssumeRolePolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": [{
        "Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]}))["Role"]
    iam.put_role_policy(RoleName=NAME, PolicyName="OnlyDisposableDatabaseCleanup", PolicyDocument=json.dumps({
        "Version": "2012-10-17", "Statement": [
            {"Effect": "Allow", "Action": "rds:DescribeDBInstances", "Resource": "*"},
            {"Effect": "Allow", "Action": ["rds:DeleteDBInstance", "rds:ListTagsForResource"], "Resource": f"arn:aws:rds:{REGION}:{ACCOUNT}:db:{DB}"},
            {"Effect": "Allow", "Action": "events:DisableRule", "Resource": f"arn:aws:events:{REGION}:{ACCOUNT}:rule/{NAME}"}]}))
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("app.py", Path(__file__).with_name("rds_activity_cleanup.py").read_text(encoding="utf-8"))
    deadline = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)
    for attempt in range(6):
        try:
            function = lam.create_function(FunctionName=NAME, Runtime="python3.12", Role=role["Arn"], Handler="app.handler",
                Code={"ZipFile": archive.getvalue()}, Timeout=20, MemorySize=128,
                Environment={"Variables": {"CLEANUP_AFTER": deadline.isoformat()}}, Tags={"Project": "RiceGuard"})
            break
        except ClientError as error:
            if "cannot be assumed" not in str(error) or attempt == 5:
                raise
            time.sleep(5)
    lam.get_waiter("function_active_v2").wait(FunctionName=NAME, WaiterConfig={"Delay": 2, "MaxAttempts": 20})
    rule = events.put_rule(Name=NAME, ScheduleExpression="rate(5 minutes)", State="DISABLED")
    lam.add_permission(FunctionName=NAME, StatementId="OnlyCleanupSchedule", Action="lambda:InvokeFunction",
                       Principal="events.amazonaws.com", SourceArn=rule["RuleArn"], SourceAccount=ACCOUNT)
    targets = events.put_targets(Rule=NAME, Targets=[{"Id": "Cleanup", "Arn": function["FunctionArn"]}])
    if targets["FailedEntryCount"]:
        raise RuntimeError("Cleanup schedule failed; database not created")
    # Check that the watchdog can run before creating anything billable.
    check = lam.invoke(FunctionName=NAME, Payload=b'{}')
    result = json.loads(check["Payload"].read())
    if check.get("FunctionError") or result.get("status") != "absent":
        raise RuntimeError(f"Cleanup test failed: {result}")
    events.enable_rule(Name=NAME)
    rds.create_db_instance(DBInstanceIdentifier=DB, DBInstanceClass="db.t4g.micro", Engine="postgres", EngineVersion="17.9",
        AllocatedStorage=20, StorageType="gp3", StorageEncrypted=True,
        MasterUsername="activity_admin", MasterUserPassword=secrets.token_urlsafe(32),
        VpcSecurityGroupIds=[sg], DBSubnetGroupName=DB, PubliclyAccessible=False,
        MultiAZ=False, BackupRetentionPeriod=0, MonitoringInterval=0, EnablePerformanceInsights=False,
        DeletionProtection=False, AutoMinorVersionUpgrade=True, CopyTagsToSnapshot=False,
        Tags=[{"Key": "Project", "Value": "RiceGuard"}, {"Key": "Purpose", "Value": "disposable-credit-activity"}])
    print(json.dumps({"database": DB, "status": "creating", "private": True,
        "cleanup_after": deadline.isoformat(), "watchdog": NAME, "gpu": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("create", "status", "cleanup", "cleanup-resources"))
    main(parser.parse_args().action)
