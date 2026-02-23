import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { S3Client, CopyObjectCommand } from "npm:@aws-sdk/client-s3";
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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sourceKey } = await req.json();
    if (!sourceKey) {
      return new Response(JSON.stringify({ error: "sourceKey is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bucket = Deno.env.get("WASABI_BUCKET")!;
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

    // Build new key: media/{new-uuid}/{original-filename}
    const filename = sourceKey.split("/").pop() || "file";
    const uuid = crypto.randomUUID();
    const newKey = `media/${uuid}/${filename}`;

    // Server-side copy within the same bucket (no download needed)
    await s3.send(new CopyObjectCommand({
      Bucket: bucket,
      CopySource: encodeURI(`${bucket}/${sourceKey}`),
      Key: newKey,
    }));

    return new Response(JSON.stringify({ key: newKey }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error copying media:", err);
    return new Response(JSON.stringify({ error: "Internal server error", detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
