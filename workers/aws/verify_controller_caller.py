"""Verify the scoped IAM URL caller, rotating only after a signed 401 test.

AWS access-key material is never printed. On a failed probe the newly created
key is deleted and the previously installed caller remains unchanged.
"""

import base64
import json
import os
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

from deploy_controller import CALLER, CONTROL, REGION, REPO


def main():
    session = boto3.Session(region_name=REGION)
    iam = session.client("iam")
    existing = iam.list_access_keys(UserName=CALLER)["AccessKeyMetadata"]
    if len(existing) != 1:
        raise RuntimeError("Expected exactly one pre-existing scoped caller key")
    new = iam.create_access_key(UserName=CALLER)["AccessKey"]
    installed = False
    try:
        url = session.client("lambda").get_function_url_config(FunctionName=CONTROL)["FunctionUrl"]
        body = b'{}'
        request = AWSRequest(method="POST", url=url, data=body, headers={"Content-Type": "application/json"})
        SigV4Auth(Credentials(new["AccessKeyId"], new["SecretAccessKey"]), "lambda", REGION).add_auth(request)
        for attempt in range(7):
            try:
                with urlopen(Request(url, data=body, headers=dict(request.headers), method="POST"), timeout=30):
                    raise RuntimeError("HMAC-free request was incorrectly accepted")
            except HTTPError as error:
                if error.code == 401:
                    break
                if error.code != 403 or attempt == 6:
                    raise RuntimeError(f"Scoped IAM probe returned {error.code}, expected application 401")
            time.sleep(10)
        env = dict(os.environ)
        env["SEND_SMS_HOOK_SECRETS"] = "v1,whsec_" + base64.b64encode(
            b"local-cli-placeholder-secret-not-for-deployment").decode()
        updated = subprocess.run(["supabase", "secrets", "set",
            f"AWS_ACCESS_KEY_ID={new['AccessKeyId']}",
            f"AWS_SECRET_ACCESS_KEY={new['SecretAccessKey']}",
            "--workdir", str(REPO)], cwd=REPO, env=env, capture_output=True, text=True)
        if updated.returncode:
            raise RuntimeError("Scoped IAM probe passed but Supabase credential update failed")
        installed = True
        iam.delete_access_key(UserName=CALLER, AccessKeyId=existing[0]["AccessKeyId"])
        print(json.dumps({"scoped_iam_probe": "passed", "hmac_free_http_status": 401,
                          "supabase_credentials_rotated": True, "old_key_deleted": True}))
    except Exception:
        # If the Edge credential update itself failed, the old key is still
        # valid. Delete only the new, never-installed key.
        current = iam.list_access_keys(UserName=CALLER)["AccessKeyMetadata"]
        if not installed and any(item["AccessKeyId"] == existing[0]["AccessKeyId"] for item in current):
            iam.delete_access_key(UserName=CALLER, AccessKeyId=new["AccessKeyId"])
        raise


if __name__ == "__main__":
    main()
