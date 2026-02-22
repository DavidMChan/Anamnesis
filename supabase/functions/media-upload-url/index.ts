import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { S3Client, PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.600.0";
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3.600.0";
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
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

    // Create S3 client for Wasabi
    const s3 = new S3Client({
      region: Deno.env.get("WASABI_REGION") || "us-east-1",
      endpoint: Deno.env.get("WASABI_ENDPOINT") || "https://s3.us-east-1.wasabisys.com",
      credentials: {
        accessKeyId: Deno.env.get("WASABI_ACCESS_KEY_ID")!,
        secretAccessKey: Deno.env.get("WASABI_SECRET_ACCESS_KEY")!,
      },
      forcePathStyle: true,
    });

    // Generate presigned PUT URL (5-minute expiry)
    const command = new PutObjectCommand({
      Bucket: Deno.env.get("WASABI_BUCKET")!,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return new Response(JSON.stringify({ uploadUrl, key }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error generating upload URL:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
