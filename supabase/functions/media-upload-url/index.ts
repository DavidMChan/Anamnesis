import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { S3Client } from "npm:@aws-sdk/client-s3";
import { createPresignedPost } from "npm:@aws-sdk/s3-presigned-post";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized", detail: authError?.message }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { filename, contentType } = await req.json();
    if (!filename || !contentType) {
      return new Response(JSON.stringify({ error: "filename and contentType are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate unique object key
    const uuid = crypto.randomUUID();
    const key = `media/${uuid}/${filename}`;

    // Wasabi S3 client — per official docs:
    // https://docs.wasabi.com/docs/how-do-i-use-aws-sdk-for-javascript-v3-with-wasabi
    const region = Deno.env.get("WASABI_REGION") || "us-west-2";
    const endpoint = `https://s3.${region}.wasabisys.com`;

    const s3 = new S3Client({
      credentials: {
        accessKeyId: Deno.env.get("WASABI_ACCESS_KEY_ID")!,
        secretAccessKey: Deno.env.get("WASABI_SECRET_ACCESS_KEY")!,
      },
      region,
      endpoint,
    });

    // Generate presigned POST (same mechanism as boto3 generate_presigned_post)
    // Wasabi auto-handles CORS, so browser POST works without bucket CORS config
    const { url, fields } = await createPresignedPost(s3, {
      Bucket: Deno.env.get("WASABI_BUCKET")!,
      Key: key,
      Conditions: [
        ["content-length-range", 1, 500 * 1024 * 1024], // 1 byte to 500 MB
        ["eq", "$Content-Type", contentType],
      ],
      Expires: 300, // 5 minutes
      Fields: {
        "Content-Type": contentType,
      },
    });

    return new Response(JSON.stringify({ url, fields, key }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error generating upload URL:", err);
    return new Response(JSON.stringify({ error: "Internal server error", detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
