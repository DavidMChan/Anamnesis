import { useEffect, useState } from 'react'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/contexts/AuthContext'
import type { Backstory, Demographics } from '@/types/database'
import { Trash2, Eye, Globe, Lock, Upload, BookOpen } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

export function Backstories() {
  const { user } = useAuthContext()
  const [backstories, setBackstories] = useState<Backstory[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [selectedBackstory, setSelectedBackstory] = useState<Backstory | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Form state
  const [backstoryText, setBackstoryText] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [demographics, setDemographics] = useState<Demographics>({})

  useEffect(() => {
    if (user) {
      fetchBackstories()
    }
  }, [user])

  const fetchBackstories = async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('backstories')
      .select('*')
      .eq('contributor_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching backstories:', error)
    } else {
      setBackstories((data as Backstory[]) || [])
    }
    setLoading(false)
  }

  const resetForm = () => {
    setBackstoryText('')
    setIsPublic(true)
    setDemographics({})
  }

  const handleSubmit = async () => {
    if (!user || !backstoryText.trim()) return

    setSaving(true)

    const { error } = await supabase.from('backstories').insert({
      contributor_id: user.id,
      source_type: 'uploaded',
      backstory_text: backstoryText.trim(),
      demographics: demographics as Record<string, unknown>,
      is_public: isPublic,
    } as Record<string, unknown>)

    if (error) {
      console.error('Error creating backstory:', error)
    } else {
      fetchBackstories()
      setDialogOpen(false)
      resetForm()
    }
    setSaving(false)
  }

  const deleteBackstory = async (id: string) => {
    const { error } = await supabase.from('backstories').delete().eq('id', id)

    if (error) {
      console.error('Error deleting backstory:', error)
    } else {
      setBackstories(backstories.filter((b) => b.id !== id))
    }
    setDeleteConfirmId(null)
  }

  const viewBackstory = (backstory: Backstory) => {
    setSelectedBackstory(backstory)
    setViewDialogOpen(true)
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Backstories</h1>
            <p className="text-muted-foreground">
              Upload and manage your own backstories
            </p>
          </div>
          <div className="flex gap-2">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Backstory
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Upload New Backstory</DialogTitle>
                  <DialogDescription>
                    Add a new backstory to your collection. You can make it public to contribute to the shared pool.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="backstory">Backstory Text</Label>
                    <Textarea
                      id="backstory"
                      value={backstoryText}
                      onChange={(e) => setBackstoryText(e.target.value)}
                      placeholder="Enter the backstory narrative..."
                      rows={8}
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="is-public"
                      checked={isPublic}
                      onCheckedChange={(checked) => setIsPublic(checked as boolean)}
                    />
                    <label htmlFor="is-public" className="text-sm">
                      Make this backstory public (contribute to shared pool)
                    </label>
                  </div>

                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-3">Demographics (Optional)</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="age">Age</Label>
                        <Input
                          id="age"
                          type="number"
                          min={0}
                          max={120}
                          value={demographics.age?.value ?? ''}
                          onChange={(e) =>
                            setDemographics({
                              ...demographics,
                              age: {
                                value: e.target.value || null,
                                distribution: e.target.value ? { [e.target.value]: 1 } : {},
                              },
                            })
                          }
                          placeholder="e.g., 28"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="gender">Gender</Label>
                        <Select
                          value={(demographics.gender?.value as string) || ''}
                          onValueChange={(value) =>
                            setDemographics({
                              ...demographics,
                              gender: { value, distribution: { [value]: 1 } },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                            <SelectItem value="non-binary">Non-binary</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="party">Political Affiliation</Label>
                        <Select
                          value={(demographics.party?.value as string) || ''}
                          onValueChange={(value) =>
                            setDemographics({
                              ...demographics,
                              party: { value, distribution: { [value]: 1 } },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select party" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="democrat">Democrat</SelectItem>
                            <SelectItem value="republican">Republican</SelectItem>
                            <SelectItem value="independent">Independent</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="education">Education Level</Label>
                        <Select
                          value={(demographics.education?.value as string) || ''}
                          onValueChange={(value) =>
                            setDemographics({
                              ...demographics,
                              education: { value, distribution: { [value]: 1 } },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select education" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="high_school">High School</SelectItem>
                            <SelectItem value="some_college">Some College</SelectItem>
                            <SelectItem value="bachelors">Bachelor's Degree</SelectItem>
                            <SelectItem value="masters">Master's Degree</SelectItem>
                            <SelectItem value="doctorate">Doctorate</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={saving || !backstoryText.trim()}>
                    {saving ? 'Uploading...' : 'Upload Backstory'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {backstories.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                <BookOpen className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No backstories yet</h3>
              <p className="text-muted-foreground text-sm mb-4 text-center max-w-sm">
                Upload your own backstories to contribute to the shared persona pool.
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Your First Backstory
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {backstories.map((backstory) => (
              <Card key={backstory.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {backstory.is_public ? (
                        <Globe className="h-4 w-4 text-primary" />
                      ) : (
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      )}
                      <CardTitle className="text-base">
                        {backstory.is_public ? 'Public' : 'Private'} Backstory
                      </CardTitle>
                    </div>
                    <Badge variant="outline">{backstory.source_type}</Badge>
                  </div>
                  <CardDescription>
                    Created {new Date(backstory.created_at).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                    {backstory.backstory_text}
                  </p>

                  {Object.keys(backstory.demographics).length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {Object.entries(backstory.demographics).map(([key, value]) => (
                        <Badge key={key} variant="secondary" className="text-xs">
                          {key}: {value.value}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => viewBackstory(backstory)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View Full
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirmId(backstory.id)}
                      aria-label="Delete backstory"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Delete Confirmation */}
        <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete backstory?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the backstory from your collection. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => deleteConfirmId && deleteBackstory(deleteConfirmId)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* View Backstory Dialog */}
        <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedBackstory?.is_public ? (
                  <Globe className="h-4 w-4 text-green-500" />
                ) : (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                )}
                Backstory Details
              </DialogTitle>
              <DialogDescription>
                {selectedBackstory?.source_type} •{' '}
                {selectedBackstory && new Date(selectedBackstory.created_at).toLocaleDateString()}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {selectedBackstory && Object.keys(selectedBackstory.demographics).length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Demographics</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selectedBackstory.demographics).map(([key, value]) => (
                      <Badge key={key} variant="secondary">
                        {key}: {value.value}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h4 className="font-medium mb-2">Backstory Text</h4>
                <div className="p-4 bg-muted rounded-md whitespace-pre-wrap text-sm">
                  {selectedBackstory?.backstory_text}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  )
}
